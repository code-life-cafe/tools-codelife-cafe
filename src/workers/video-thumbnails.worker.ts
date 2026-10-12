import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { thumbnailTimes, type VideoInfo } from '../lib/tools/video-compress';

self.onmessage = async (
	event: MessageEvent<{
		file: File;
		info: Pick<VideoInfo, 'duration' | 'startTimestamp'>;
	}>,
) => {
	const input = new Input({
		source: new BlobSource(event.data.file),
		formats: ALL_FORMATS,
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('映像なし');
		const first = await track.getFirstTimestamp();
		const last = await track.computeDuration();
		const sink = new CanvasSink(track, {
			width: 160,
			height: 90,
			fit: 'contain',
		});
		const blobs: Blob[] = [];
		for (const relative of thumbnailTimes(event.data.info.duration)) {
			const timestamp = Math.max(
				first,
				Math.min(
					last - 0.000001,
					(event.data.info.startTimestamp ?? 0) + relative,
				),
			);
			const frame = await sink.getCanvas(timestamp);
			if (!frame || !(frame.canvas instanceof OffscreenCanvas))
				throw new Error('フレームなし');
			blobs.push(
				await frame.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }),
			);
		}
		self.postMessage(blobs);
	} catch {
		self.postMessage(null);
	} finally {
		input.dispose();
	}
};
