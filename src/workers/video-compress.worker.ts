import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	canEncodeAudio,
	canEncodeVideo,
	Input,
	Mp4OutputFormat,
	Output,
	Quality,
} from 'mediabunny';
import {
	AUDIO_BITRATE,
	assertTracksPreserved,
	compressionPlan,
	MAX_OUTPUT_BYTES,
	MAX_VIDEO_BYTES,
	type VideoInfo,
	type VideoJob,
	type VideoReply,
} from '../lib/tools/video-compress';

let input: Input | undefined;
let info: VideoInfo | undefined;
let busy = false;
function reply(message: VideoReply, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}
self.onmessage = async (
	event: MessageEvent<
		{ type: 'load'; file: File } | { type: 'compress'; job: VideoJob }
	>,
) => {
	if (busy) return;
	busy = true;
	try {
		if (event.data.type === 'load') {
			const file = event.data.file;
			if (!file.size || file.size > MAX_VIDEO_BYTES)
				throw new Error(
					'動画は空でない256MiB以下のファイルを選択してください。',
				);
			if (!/\.(mp4|mov|webm|mkv)$/i.test(file.name))
				throw new Error('MP4・MOV・WebM・MKVの動画を選択してください。');
			if (
				typeof VideoEncoder === 'undefined' ||
				typeof VideoDecoder === 'undefined'
			)
				throw new Error(
					'このブラウザーは動画圧縮に対応していません。最新版のChromeまたはEdgeをお試しください。',
				);
			input?.dispose();
			input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
			const video = await input.getPrimaryVideoTrack();
			if (!video || !(await video.canDecode()))
				throw new Error(
					'この動画の映像を読み込めません。コーデックが非対応の可能性があります。',
				);
			const duration = await input.computeDuration();
			if (!Number.isFinite(duration) || duration <= 0)
				throw new Error('動画の長さを読み取れません。');
			const stats = await video.computePacketStats(100);
			const audioTracks = await input.getAudioTracks();
			let audioBitrate = 0;
			for (const track of audioTracks) {
				if (track.codec === 'aac') {
					const audioStats = await track.computePacketStats();
					if (
						!Number.isFinite(audioStats.averageBitrate) ||
						audioStats.averageBitrate <= 0
					)
						throw new Error('音声の容量を読み取れません。');
					audioBitrate += Math.ceil(audioStats.averageBitrate);
				} else audioBitrate += AUDIO_BITRATE;
			}
			info = {
				width: video.displayWidth,
				height: video.displayHeight,
				duration,
				audioTracks: audioTracks.length,
				audioBitrate,
				frameRate:
					Number.isFinite(stats.averagePacketRate) &&
					stats.averagePacketRate > 0
						? stats.averagePacketRate
						: 30,
			};
			reply({ type: 'ready', info });
		} else {
			if (!input || !info) throw new Error('動画を選択してください。');
			const job = event.data.job;
			const plan = compressionPlan(info, job);
			const video = await input.getPrimaryVideoTrack();
			if (!video) throw new Error('映像がありません。');
			const audio = await input.getAudioTracks();
			const videoQuality = new Quality({
				bitrate: plan.videoBitrate,
				bitrateMode: 'variable',
			});
			if (
				!(await canEncodeVideo('avc', {
					width: plan.width,
					height: plan.height,
					frameRate: plan.frameRate,
					quality: videoQuality,
				}))
			)
				throw new Error(
					'この環境ではH.264の書き出しができません。解像度を下げるか最新版のChrome・Edgeをお試しください。',
				);
			if (!job.settings.removeAudio) {
				for (const track of audio) {
					if (track.codec === 'aac') continue;
					if (
						!(await track.canDecode()) ||
						!(await canEncodeAudio('aac', {
							numberOfChannels: Math.min(2, track.numberOfChannels),
							sampleRate: 48000,
							quality: new Quality({ bitrate: AUDIO_BITRATE }),
						}))
					)
						throw new Error(
							'この環境では音声のAAC変換ができません。「音声を削除」を選ぶか別のブラウザーをお試しください。',
						);
				}
			}
			const target = new BufferTarget();
			const output = new Output({ format: new Mp4OutputFormat(), target });
			const conversion = await Conversion.init({
				input,
				output,
				trim: { start: job.start, end: job.end },
				copy: { boundaryPolicy: 'shrink', shiftTolerance: 0 },
				video: (track) =>
					track.id === video.id
						? {
								width: plan.width,
								height: plan.height,
								fit: 'contain',
								frameRate: plan.frameRate,
								codec: 'avc',
								quality: videoQuality,
								forceTranscode: true,
								allowTransformationMetadata: false,
							}
						: { discard: true },
				audio: (track) =>
					job.settings.removeAudio
						? { discard: true }
						: track.codec === 'aac'
							? { codec: 'aac' }
							: {
									codec: 'aac',
									quality: new Quality({ bitrate: AUDIO_BITRATE }),
									sampleRate: 48000,
									numberOfChannels: Math.min(2, track.numberOfChannels),
									forceTranscode: true,
								},
				tags: {},
				showWarnings: false,
			});
			const required = [
				video.id,
				...(!job.settings.removeAudio ? audio.map((track) => track.id) : []),
			];
			assertTracksPreserved(
				required,
				conversion.utilizedTracks.map((track) => track.id),
			);
			if (!conversion.isValid) throw new Error('この動画を変換できません。');
			let oversized = false;
			target.on('write', ({ end }) => {
				if (end > MAX_OUTPUT_BYTES && !oversized) {
					oversized = true;
					void conversion.cancel();
				}
			});
			conversion.onProgress = (progress) =>
				reply({ type: 'progress', progress });
			try {
				await conversion.execute();
			} catch (error) {
				if (oversized)
					throw new Error(
						'出力が128MiBを超えたため停止しました。設定を下げて再実行してください。',
					);
				throw error;
			}
			if (!target.buffer) throw new Error('書き出しに失敗しました。');
			reply({ type: 'done', buffer: target.buffer }, [target.buffer]);
		}
	} catch (error) {
		// ライブラリ例外の生文言にはファイル由来の情報が含まれうるため返さない。
		const message =
			error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message)
				? error.message
				: '動画を処理できませんでした。破損・非対応の動画か、端末のメモリ不足の可能性があります。';
		reply({ type: 'error', message });
	} finally {
		busy = false;
	}
};
