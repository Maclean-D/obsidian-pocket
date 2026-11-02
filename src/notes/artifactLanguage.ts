import type { ArtifactLanguage, ConversationArtifactKind, PocketTrackedRecord } from "../types";

interface ArtifactVocabulary {
 filenames: Record<ConversationArtifactKind, string>;
 labels: Record<ConversationArtifactKind, string>;
}

export const ARTIFACT_LANGUAGES: Record<ArtifactLanguage, ArtifactVocabulary> = {
 en: { filenames: { summary: "summary.md", transcript: "transcript.md", "action-items": "action-items.md", mindmap: "mindmap.md" }, labels: { summary: "Summary", transcript: "Transcript", "action-items": "Action items", mindmap: "Mind map" } },
 es: { filenames: { summary: "Resumen.md", transcript: "Transcripción.md", "action-items": "Tareas.md", mindmap: "Mapa mental.md" }, labels: { summary: "Resumen", transcript: "Transcripción", "action-items": "Tareas", mindmap: "Mapa mental" } },
 fr: { filenames: { summary: "Résumé.md", transcript: "Transcription.md", "action-items": "Actions.md", mindmap: "Carte mentale.md" }, labels: { summary: "Résumé", transcript: "Transcription", "action-items": "Actions", mindmap: "Carte mentale" } },
 de: { filenames: { summary: "Zusammenfassung.md", transcript: "Transkript.md", "action-items": "Aufgaben.md", mindmap: "Gedankenkarte.md" }, labels: { summary: "Zusammenfassung", transcript: "Transkript", "action-items": "Aufgaben", mindmap: "Gedankenkarte" } },
 it: { filenames: { summary: "Riepilogo.md", transcript: "Trascrizione.md", "action-items": "Attività.md", mindmap: "Mappa mentale.md" }, labels: { summary: "Riepilogo", transcript: "Trascrizione", "action-items": "Attività", mindmap: "Mappa mentale" } },
 pt: { filenames: { summary: "Resumo.md", transcript: "Transcrição.md", "action-items": "Tarefas.md", mindmap: "Mapa mental.md" }, labels: { summary: "Resumo", transcript: "Transcrição", "action-items": "Tarefas", mindmap: "Mapa mental" } },
};

export function sanitizeArtifactLanguage(value: unknown): ArtifactLanguage {
 return typeof value === "string" && Object.prototype.hasOwnProperty.call(ARTIFACT_LANGUAGES, value) ? value as ArtifactLanguage : "en";
}

export function artifactVocabulary(language: unknown): ArtifactVocabulary {
 return ARTIFACT_LANGUAGES[sanitizeArtifactLanguage(language)];
}

/** Canonical kinds survive localized names, collision suffixes, and manual renames. */
export function trackedArtifactKinds(record: PocketTrackedRecord): Partial<Record<ConversationArtifactKind, string>> {
 const result = { ...record.artifactPathsByKind };
 const paths = [...record.artifactPaths, record.notePath].filter(Boolean);
 for (const kind of ["summary", "transcript", "action-items", "mindmap"] as const) {
  if (result[kind]) continue;
  const aliases = new Set(Object.values(ARTIFACT_LANGUAGES).map(v => v.filenames[kind].normalize("NFC").toLowerCase()));
  const path = paths.find(path => aliases.has((path.split("/").pop() ?? "").normalize("NFC").toLowerCase()));
  if (path) result[kind] = path;
 }
 return result;
}

export function isArtifactFilename(path: string, kind: ConversationArtifactKind): boolean {
 const basename = (path.split("/").pop() ?? "").normalize("NFC").toLowerCase();
 return Object.values(ARTIFACT_LANGUAGES).some(v => v.filenames[kind].normalize("NFC").toLowerCase() === basename);
}
