// DropZone — 音声/動画ファイルの入力。共通 FileDropzone を薄くラップする。

import { FileDropzone } from '@/components/common/FileDropzone';
import {
	ACCEPT_ATTRIBUTE,
	MAX_FILE_SIZE,
	SUPPORTED_EXTENSIONS,
	validateAudioFile,
} from '@/lib/transcribe/audio-browser';

type DropZoneProps = {
	fileName: string | null;
	onFileSelect: (file: File) => void;
	onValidationError: (message: string) => void;
	onClear: () => void;
	disabled?: boolean;
};

export function DropZone({
	fileName,
	onFileSelect,
	onValidationError,
	onClear,
	disabled,
}: DropZoneProps) {
	return (
		<FileDropzone
			accept={ACCEPT_ATTRIBUTE}
			maxSizeBytes={MAX_FILE_SIZE}
			validationMessage={`ファイルサイズが上限（${Math.round(MAX_FILE_SIZE / 1024 ** 2)}MB）を超えています。`}
			validate={(file) => {
				const result = validateAudioFile(file);
				return result.ok ? null : result.message;
			}}
			label="音声・動画ファイルをドロップ"
			description={`${SUPPORTED_EXTENSIONS.join(' / ')} に対応（15分以内）`}
			privacyNote="音声はこの端末から出ません"
			selectedFileName={fileName}
			onFileSelect={onFileSelect}
			onValidationError={onValidationError}
			onClear={onClear}
			disabled={disabled}
			inputAriaLabel="文字起こしする音声・動画ファイルを選択"
			data-testid="transcribe-dropzone"
		/>
	);
}
