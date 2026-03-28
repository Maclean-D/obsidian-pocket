export function subtractDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() - days);
	return next;
}

export function toPocketDateString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function formatLocalDate(dateLike: string): string {
	const date = new Date(dateLike);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalYearMonth(dateLike: string): { year: string; month: string } {
	const date = new Date(dateLike);
	return {
		year: String(date.getFullYear()),
		month: pad(date.getMonth() + 1),
	};
}

export function formatDisplayDateTime(dateLike: string | null): string {
	if (!dateLike) {
		return "Never";
	}

	const date = new Date(dateLike);
	return `${formatLocalDate(dateLike)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDurationSeconds(durationSeconds: number | null): string {
	if (durationSeconds == null || Number.isNaN(durationSeconds)) {
		return "Unknown";
	}

	const hours = Math.floor(durationSeconds / 3600);
	const minutes = Math.floor((durationSeconds % 3600) / 60);
	const seconds = Math.floor(durationSeconds % 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}

	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}

	return `${seconds}s`;
}

export function formatTranscriptTimestamp(seconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainder = totalSeconds % 60;

	if (hours > 0) {
		return `${pad(hours)}:${pad(minutes)}:${pad(remainder)}`;
	}

	return `${pad(minutes)}:${pad(remainder)}`;
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

