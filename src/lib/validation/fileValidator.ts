import { MAX_CSV_FILE_BYTES } from '../tools/csv-fixer.ts';

export interface ValidationResult {
	valid: boolean;
	error?: 'INVALID_EXTENSION' | 'FILE_TOO_LARGE' | 'EMPTY_FILE';
	maxSize: number;
}

export function getMaxFileSize(): number {
	return MAX_CSV_FILE_BYTES;
}

export function validateFile(file: File): ValidationResult {
	const maxSize = getMaxFileSize();

	if (file.size === 0) {
		return { valid: false, error: 'EMPTY_FILE', maxSize };
	}

	if (file.size > maxSize) {
		return { valid: false, error: 'FILE_TOO_LARGE', maxSize };
	}

	const validExtensions = ['.csv', '.tsv', '.txt'];
	const fileName = file.name.toLowerCase();
	const hasValidExtension = validExtensions.some((ext) =>
		fileName.endsWith(ext),
	);

	if (!hasValidExtension) {
		return { valid: false, error: 'INVALID_EXTENSION', maxSize };
	}

	return { valid: true, maxSize };
}
