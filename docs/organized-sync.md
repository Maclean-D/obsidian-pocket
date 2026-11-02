# Organized sync

Pocket Sync can mirror Pocket's own hierarchy of spaces and folders into your vault, on top of the default date-based layout.

## Enabling folder organization

Open **Settings → Community plugins → Pocket Sync → Pocket folders and metadata** and set **Organization mode** to **Follow Pocket folders**. In this mode each recording is placed under the same path it has in Pocket, grouped by space and folder instead of by date. Recordings are identified by their Pocket id, so two recordings that share a title never mix their notes.

Keep **Date and template** selected to use the original date-based layout.

## Recording metadata

When organization follows Pocket, each note stores its recording metadata as frontmatter properties: the space, folder, participants, keywords, and tags, along with the recording timestamp. You can filter notes by these properties. Filtering by a space or folder id is different from filtering by tags: classifying a recording into *Work* does not add a *Work* tag.

Narrow what gets synced with **Include folder ids**, **Exclude folder ids**, **Include space ids**, and **Exclude space ids**. Folder filters match that folder, while space filters also match its descendants. Exclusions take priority, and an empty field means no filter.

## Folder index

Enable **Generate folder index** to write an index note that lists existing summaries and still-pending recordings, grouped by folder, with a link to each summary.

## Folder database view

Use the **Create folder database view** command or the **Create view** button to generate a table of your recordings that you can filter by space, folder, tags, and date. It relies on frontmatter and Obsidian's built-in database feature.

## Preview before applying

Use the **Preview organization** command or button to see exactly which notes would be created, moved, or archived — without changing anything. The result opens in the sync report. When you are happy with the plan, run **Update organization** to apply it. **Update content** forces a refresh of the remote content for the existing notes.

## Manual moves

If you move a note to a location of your own, **Manual moves** decides what happens on the next reconciliation:

- **Keep local location** leaves the note where you put it.
- **Follow remote folders** moves it back to match Pocket.

## Year, month, and day grouping

Enable **Group by year and month** to add a `YYYY/MM` segment beneath each conversation folder (or beneath the conversation root in date mode), and **Group by day** to add `DD` beneath it. Dates use the **Time zone** setting. Existing notes move on the next sync; manually pinned folders stay in place.

## Artifact language

**Artifact language** changes the generated filenames and navigation labels — for example `Transcript.md` versus `Transcripción.md`. It does not translate note content or internal properties. English keeps the original filenames.

## Collision handling

When two recordings would produce the same folder or note name, **Duplicate filename policy** avoids the collision by either adding a suffix or keeping the tracked note path.

## Interrupted-operation recovery

Sync operations are journaled to disk before they touch the vault. If Obsidian quits mid-sync, Pocket Sync detects the interrupted run on the next load and reconciles the pending moves — and it only adopts a destination after verifying its content matches what was planned. You can always run **Sync now** again to retry.

## Mirror mode

Set **Note management mode** to **Mirror Pocket (replace local content)** to make a full refresh replace the note body with Pocket's rendered content, while keeping navigation and frontmatter. Metadata-only sync keeps your body; run **Update content** to migrate existing notes.

## Content refresh and rate limiting

Set **Content refresh days** to periodically re-check content even when Pocket's update timestamp has not changed. Sync requests are rate-limit aware: when the API reports `429`, Pocket Sync waits for the limit to reset, and it retries transient server errors with backoff.
