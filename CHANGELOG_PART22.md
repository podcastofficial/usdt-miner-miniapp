# Part 22 — Admin Operations Workspace

Adds private admin user notes and saved user-segment definitions. Notes are attributed to the admin who wrote them, bounded to 1,000 characters, and visible only through admin-protected endpoints. Saved segment criteria are allow-listed (blocked status, last-active days, and Points bounds); arbitrary SQL or user-supplied query expressions are never executed. All writes are audited.

API: `adminUserNotes`, `adminUserNoteAdd`, `adminSegments`, `adminSegmentSave`, `adminSegmentDelete`.
Migration: `020_part22_admin_ops.sql`.
