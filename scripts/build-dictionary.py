#!/usr/bin/env python3
"""Build the Rewiaty offline Arabic dictionary from an official arwiktionary dump.

This script is the reproducible, stdlib-only builder behind F49. It never ships
the dump or the generated SQLite file in git: both are ignored by `.gitignore`
and are meant to be produced locally (or in CI) with this script.

Pipeline (matches the verified v2 build):

1. Stream a **dated** ``arwiktionary-YYYYMMDD-pages-articles.xml.bz2`` dump page
   by page. The builder never downloads ``/latest/``: a pinned dump date keeps
   the build reproducible and lets the SHA-256 pin stay meaningful.
2. Keep main-namespace pages whose title is a single Arabic word of two or more
   Arabic letters after normalization (mirrors the TypeScript stemmer, so an
   entry the app would never query is never written).
3. Extract the Arabic-language section and its definitions (``#`` lines first,
   then prose / ``*`` bullets under ``=== المعاني ===`` or a POS heading).
4. Normalize the headword exactly like ``normalizeArabicWord`` in
   ``apps/mobile/src/storage/arabic-stemmer.ts`` and record ``pos`` / ``root``.
5. Write a deterministic SQLite file (``entries`` + ``meta``) through a
   temporary sibling file, then atomically replace the output, and write a
   metadata JSON document with the dump hash, license and attribution.

Usage::

    python3 scripts/build-dictionary.py \
        --input /tmp/arwiktionary-20261101-pages-articles.xml.bz2 \
        --output apps/mobile/assets/dictionary/arwiktionary.sqlite \
        --meta-out scripts/dictionary-meta.json

    # or let the script fetch and cache the pinned dump itself
    python3 scripts/build-dictionary.py --download --cache-dir /tmp/dumps \
        --output apps/mobile/assets/dictionary/arwiktionary.sqlite \
        --meta-out scripts/dictionary-meta.json

``--download`` (and any build that writes the distributed metadata document)
refuses to run without a SHA-256, taken from ``--verify-sha256`` or from
``--meta-in`` (``scripts/dictionary-meta.json`` by default). Pass
``--allow-unverified`` only for a local experiment against a synthetic dump.

The dictionary content is licensed CC BY-SA 4.0 by the Arabic Wiktionary
contributors; the application source keeps its own license (see
``apps/mobile/LICENSE``, the Expo template's MIT notice).
"""

from __future__ import annotations

import argparse
import bz2
import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import IO, Iterator

SOURCE = "arwiktionary"
DEFAULT_DUMP_DATE = "2026-11-01"
DUMP_URL_TEMPLATE = (
    "https://dumps.wikimedia.org/{source}/{date}/{source}-{date}-pages-articles.xml.bz2"
)
DEFAULT_META_IN = Path("scripts/dictionary-meta.json")
LICENSE = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
ATTRIBUTION_AR = (
    "بيانات القاموس من مساهمي ويكاموس العربي، مرخّصة بموجب المشاع الإبداعي CC BY-SA 4.0."
)
ATTRIBUTION_EN = (
    "Dictionary data by Arabic Wiktionary contributors, licensed under CC BY-SA 4.0."
)
SCHEMA_VERSION = 1

MAX_PASS1_DEFINITIONS = 4
MAX_PASS2_DEFINITIONS = 3
MIN_DEFINITION_LENGTH = 4
MIN_PASS2_DEFINITION_LENGTH = 6
# Mirrors `MIN_STEM_LENGTH` in `apps/mobile/src/storage/arabic-stemmer.ts`: the
# app never queries a one-letter word, so the builder must not store one.
MIN_ENTRY_LENGTH = 2

TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
ARABIC_CHAR_RE = re.compile(r"[\u0621-\u064A]")
# Everything outside the Arabic letter block, exactly as the TS stemmer strips
# it: punctuation (including "-"), whitespace, digits and Latin letters.
NON_ARABIC_LETTER_RE = re.compile(r"[^\u0621-\u064A]")
ARABIC_SECTION_RE = re.compile(
    r"(?m)^==\s*(?:\{\{اللغة\|عربية\}\}|\{\{-ar-\}\}|العربية)\s*==\s*$"
)
NEXT_TOP_HEADING_RE = re.compile(r"(?m)^==[^=]")
ROOT_TEMPLATE_RE = re.compile(r"\{\{(?:جذر|الجذر)\|([^}|]+)")
ROOT_CATEGORY_RE = re.compile(
    r"\[\[تصنيف:([\u0621-\u064A]\s+[\u0621-\u064A]\s+[\u0621-\u064A](?:\s+[\u0621-\u064A])?)\]\]"
)
POS_TEMPLATES = ("فعل", "اسم", "صفة", "حرف", "مصدر", "ظرف", "ضمير", "عدد", "أداة")
MEANING_HEADINGS = ("المعاني", "المعنى", "معنى", "التعريف", "اسم", "فعل", "صفة", "حرف", "مصدر", "ظرف")
STOP_HEADINGS = (
    "ترجمات",
    "الترجمات",
    "مرادفات",
    "المرادفات",
    "أضداد",
    "الأضداد",
    "انظر",
    "انْظُرْ",
    "مراجع",
    "المراجع",
    "وصلات",
    "تصريف",
    "التصريف",
    "النطق",
    "الأصل",
)
DUMP_DATE_IN_NAME_RE = re.compile(r"(\d{8})")


class DictionaryBuildError(RuntimeError):
    """Raised when the dump is missing, corrupt, or fails its integrity check."""


def dump_url_for_date(dump_date: str) -> str:
    """Return the pinned (dated) official dump URL for one dump date.

    ``dump_date`` is ``YYYY-MM-DD`` or ``YYYYMMDD``. The URL is never
    ``/latest/``: a moving target cannot be pinned by date and SHA-256.
    """
    date = dump_date.replace("-", "")
    if len(date) != 8 or not date.isdigit():
        raise DictionaryBuildError(f"dump date must be YYYY-MM-DD or YYYYMMDD: {dump_date}")
    return DUMP_URL_TEMPLATE.format(source=SOURCE, date=date)


#: Backwards-compatible default (the pinned 2026-11-01 dump), never `/latest/`.
SOURCE_URL = dump_url_for_date(DEFAULT_DUMP_DATE)


def normalize_ar(word: str) -> str:
    """Normalize an Arabic headword for exact-match lookups.

    Character-for-character the same as ``normalizeArabicWord`` in
    ``apps/mobile/src/storage/arabic-stemmer.ts``: strips tashkeel/tatweel,
    folds the orthographic variants Arabic readers treat as one word
    (أإآٱ -> ا, ى -> ي, ة -> ه, ؤ -> و, ئ -> ي), then removes everything that
    is not an Arabic letter (punctuation, hyphens, spaces, digits, Latin).
    """
    normalized = TASHKEEL_RE.sub("", word or "")
    for source, replacement in (
        ("أ", "ا"),
        ("إ", "ا"),
        ("آ", "ا"),
        ("ٱ", "ا"),
        ("ى", "ي"),
        ("ة", "ه"),
        ("ؤ", "و"),
        ("ئ", "ي"),
    ):
        normalized = normalized.replace(source, replacement)
    return NON_ARABIC_LETTER_RE.sub("", normalized)


def normalize_entry_word(title: str) -> str | None:
    """Normalized headword for storage, or `None` when it is not an entry.

    Applied identically here and at lookup time in the app: a normalized form
    shorter than two Arabic letters is never queried, so it is never stored.
    """
    normalized = normalize_ar(title)
    if len(normalized) < MIN_ENTRY_LENGTH:
        return None
    return normalized


def strip_wiki_markup(text: str) -> str:
    """Turn one line of Wiktionary wiki markup into readable plain text."""
    cleaned = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    cleaned = re.sub(r"<ref[^>]*>.*?</ref>", "", cleaned, flags=re.S)
    cleaned = re.sub(r"<ref[^>]*/\s*>", "", cleaned)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(
        r"\[\[(?:ملف|صورة|تصنيف|File|Image|Category):[^\]]+\]\]",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", cleaned)
    cleaned = re.sub(r"\[\[([^\]]+)\]\]", r"\1", cleaned)
    cleaned = re.sub(r"\[https?://[^\s\]]+\s*([^\]]*)\]", r"\1", cleaned)
    for _ in range(3):
        cleaned = re.sub(r"\{\{[^{}]*\}\}", "", cleaned)
    cleaned = cleaned.replace("'''", "").replace("''", "")
    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" :;-–—*#•")


def extract_arabic_section(text: str) -> str | None:
    """Return the Arabic-language section of a Wiktionary page, if any."""
    match = ARABIC_SECTION_RE.search(text or "")
    if not match:
        return None
    start = match.end()
    next_heading = NEXT_TOP_HEADING_RE.search(text, start)
    return text[start : next_heading.start()] if next_heading else text[start:]


def extract_root(section: str) -> str | None:
    """Return the triliteral root declared by a Wiktionary entry."""
    match = ROOT_TEMPLATE_RE.search(section)
    if match:
        root = strip_wiki_markup(match.group(1))
        return root or None
    category = ROOT_CATEGORY_RE.search(section)
    if category:
        return category.group(1)
    return None


def extract_pos(section: str) -> str | None:
    """Return the part of speech declared by a Wiktionary entry."""
    for pos in POS_TEMPLATES:
        if f"{{{{{pos}" in section or re.search(rf"===\s*{re.escape(pos)}\s*===", section):
            return pos
    return None


def extract_definitions(section: str) -> list[str]:
    """Extract up to four readable Arabic definitions from an Arabic section."""
    if "{{توضيح}}" in section:
        return []

    # Pass 1 — standard Wiktionary definition lines ("# ..."), skipping the
    # nested example/translation lines that start with "#:", "#*" or "##".
    definitions: list[str] = []
    for line in section.splitlines():
        if not re.match(r"^#(?![:*#])", line):
            continue
        cleaned = strip_wiki_markup(line[1:])
        if len(cleaned) >= MIN_DEFINITION_LENGTH and ARABIC_CHAR_RE.search(cleaned):
            definitions.append(cleaned)
            if len(definitions) >= MAX_PASS1_DEFINITIONS:
                return definitions
    if definitions:
        return definitions

    # Pass 2 — "=== المعاني ===" (or a POS heading) whose senses are prose or
    # "*" bullets instead of "#" lines. Stop headings are ignored entirely.
    in_meaning_section = False
    for raw_line in section.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        heading = re.match(r"^={3,4}\s*([^=]+?)\s*={3,4}$", line)
        if heading:
            heading_text = strip_wiki_markup(heading.group(1))
            if any(keyword in heading_text for keyword in STOP_HEADINGS):
                in_meaning_section = False
            elif any(keyword in heading_text for keyword in MEANING_HEADINGS):
                in_meaning_section = True
            else:
                in_meaning_section = False
            continue
        if not in_meaning_section:
            continue
        if line.startswith("[[تصنيف:"):
            continue
        if line.startswith("{{") and line.endswith("}}"):
            continue
        if line.startswith("*") or not line.startswith(("{", "|", "!", ":")):
            cleaned = strip_wiki_markup(line)
            if (
                len(cleaned) >= MIN_PASS2_DEFINITION_LENGTH
                and ARABIC_CHAR_RE.search(cleaned)
            ):
                definitions.append(cleaned)
                if len(definitions) >= MAX_PASS2_DEFINITIONS:
                    break
    return definitions


def is_dictionary_title(title: str) -> bool:
    """Only single Arabic headwords enter the dictionary."""
    return bool(
        title
        and ARABIC_CHAR_RE.search(title)
        and ":" not in title
        and " " not in title
        and "\t" not in title
        and "\n" not in title
    )


def iter_dictionary_entries(stream: IO[bytes]) -> Iterator[dict[str, str | None]]:
    """Yield normalized dictionary entries from an XML dump stream."""
    for _event, elem in ET.iterparse(stream, events=("end",)):
        if not elem.tag.endswith("}page"):
            continue
        namespace = elem.findtext("{*}ns")
        if namespace == "0":
            title = (elem.findtext("{*}title") or "").strip()
            if is_dictionary_title(title):
                page_text = elem.findtext(".//{*}text") or ""
                section = extract_arabic_section(page_text)
                if section:
                    definitions = extract_definitions(section)
                    normalized = normalize_entry_word(title)
                    if definitions and normalized:
                        yield {
                            "word": title,
                            "norm": normalized,
                            "pos": extract_pos(section),
                            "root": extract_root(section),
                            "defs": "\n".join(definitions),
                        }
        elem.clear()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """Return the hex SHA-256 digest of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dump_date_from_filename(path: str | Path) -> str | None:
    """Derive ``YYYY-MM-DD`` from a dated dump filename, e.g. ``…-20261101-…``."""
    match = DUMP_DATE_IN_NAME_RE.search(Path(path).name)
    if not match:
        return None
    raw = match.group(1)
    try:
        parsed = datetime.strptime(raw, "%Y%m%d")
    except ValueError:
        return None
    return parsed.strftime("%Y-%m-%d")


def downloads_cache_path(cache_dir: Path, source_url: str = SOURCE_URL) -> Path:
    """Where `--download` stores the official dump."""
    return cache_dir / source_url.rsplit("/", 1)[-1]


def download_dump(cache_dir: Path, source_url: str = SOURCE_URL) -> Path:
    """Download the pinned dump into `cache_dir` unless it is already there."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = downloads_cache_path(cache_dir, source_url)
    if target.exists() and target.stat().st_size > 0:
        return target
    partial = target.with_suffix(target.suffix + ".part")
    with urllib.request.urlopen(source_url) as response, partial.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
    partial.replace(target)
    return target


def load_pinned_meta(meta_path: str | Path | None) -> dict[str, object]:
    """Load the pinned metadata document (`scripts/dictionary-meta.json`).

    Returns an empty mapping when the file is absent, so a synthetic/local build
    is still possible — but callers must then supply an explicit
    ``--verify-sha256`` (or ``--allow-unverified``). A present but malformed
    document is an error, never a silent fallback to an unverified build.
    """
    if meta_path is None:
        return {}
    path = Path(meta_path)
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DictionaryBuildError(f"cannot read pinned metadata {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise DictionaryBuildError(f"pinned metadata {path} is not a JSON object")
    return payload


def temporary_build_path(destination: Path) -> Path:
    """A temporary sibling used while the SQLite file is still incomplete."""
    return destination.with_name(f"{destination.name}.tmp.{os.getpid()}")


def build_dictionary_db(
    input_path: str | Path,
    output_path: str | Path,
    *,
    dump_date: str,
    meta_out: str | Path | None = None,
    verify_sha256: str | None = None,
) -> dict[str, object]:
    """Build the offline dictionary SQLite database.

    The database is written to a temporary sibling file and only moved onto
    ``output_path`` once it is complete and verified. A corrupt or truncated
    dump (``ET.ParseError``) therefore leaves any previously shipped SQLite
    file exactly as it was.

    Returns a stats dictionary with `entry_count`, `sqlite_size_bytes`,
    `dump_sha256`, `dump_date` and `output`. Raises `DictionaryBuildError` when
    the input is missing or its SHA-256 does not match `verify_sha256`.
    """
    source_path = Path(input_path)
    destination = Path(output_path)
    if not source_path.is_file():
        raise DictionaryBuildError(f"dictionary dump not found: {source_path}")

    started_at = time.time()
    dump_sha256 = sha256_file(source_path)
    if verify_sha256 and dump_sha256.lower() != verify_sha256.strip().lower():
        raise DictionaryBuildError(
            "dump SHA-256 mismatch: "
            f"expected {verify_sha256.strip().lower()}, got {dump_sha256}"
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = temporary_build_path(destination)
    if tmp_path.exists():
        tmp_path.unlink()

    entry_count = 0
    batch: list[tuple[str, str, str | None, str | None, str]] = []
    connection: sqlite3.Connection | None = None

    try:
        connection = sqlite3.connect(str(tmp_path))
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("PRAGMA synchronous=OFF")
        connection.execute(
            """
            CREATE TABLE entries (
                id INTEGER PRIMARY KEY,
                word TEXT NOT NULL,
                norm TEXT NOT NULL,
                pos TEXT,
                root TEXT,
                defs TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        with bz2.open(source_path, "rb") as stream:
            for entry in iter_dictionary_entries(stream):
                batch.append(
                    (
                        str(entry["word"]),
                        str(entry["norm"]),
                        entry["pos"] if entry["pos"] is not None else None,
                        entry["root"] if entry["root"] is not None else None,
                        str(entry["defs"]),
                    )
                )
                entry_count += 1
                if len(batch) >= 5000:
                    connection.executemany(
                        "INSERT INTO entries (word, norm, pos, root, defs) VALUES (?, ?, ?, ?, ?)",
                        batch,
                    )
                    batch.clear()
        if batch:
            connection.executemany(
                "INSERT INTO entries (word, norm, pos, root, defs) VALUES (?, ?, ?, ?, ?)",
                batch,
            )
            batch.clear()

        connection.execute("CREATE INDEX idx_entries_norm ON entries(norm)")

        meta_rows = {
            "source": SOURCE,
            "source_url": dump_url_for_date(dump_date),
            "license": LICENSE,
            "license_url": LICENSE_URL,
            "attribution": ATTRIBUTION_AR,
            "dump_date": dump_date,
            "dump_sha256": dump_sha256,
            "entry_count": str(entry_count),
            "schema_version": str(SCHEMA_VERSION),
        }
        connection.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            sorted(meta_rows.items()),
        )
        connection.commit()

        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = {"entries", "meta"} - tables
        if missing:
            raise DictionaryBuildError(
                f"built database is missing tables: {', '.join(sorted(missing))}"
            )

        connection.execute("VACUUM")
        connection.commit()
    except BaseException:
        # Never leave a half-written build behind, and never touch the previous
        # good output: only `os.replace` below publishes a complete file.
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:  # pragma: no cover - defensive
                pass
        tmp_path.unlink(missing_ok=True)
        raise
    else:
        connection.close()

    os.replace(tmp_path, destination)

    sqlite_size_bytes = destination.stat().st_size
    stats: dict[str, object] = {
        "entry_count": entry_count,
        "sqlite_size_bytes": sqlite_size_bytes,
        "dump_sha256": dump_sha256,
        "dump_date": dump_date,
        "source_url": dump_url_for_date(dump_date),
        "output": str(destination),
        "elapsed_seconds": round(time.time() - started_at, 1),
    }

    if meta_out is not None:
        write_meta_json(Path(meta_out), stats)

    return stats


def build_meta_document(stats: dict[str, object]) -> dict[str, object]:
    """Metadata document shared by `--meta-out` and the committed JSON."""
    return {
        "source": SOURCE,
        "source_url": stats.get("source_url") or SOURCE_URL,
        "dump_date": stats["dump_date"],
        "dump_sha256": stats["dump_sha256"],
        "license": LICENSE,
        "license_url": LICENSE_URL,
        "attribution_ar": ATTRIBUTION_AR,
        "attribution_en": ATTRIBUTION_EN,
        "entry_count": stats["entry_count"],
        "sqlite_size_bytes": stats["sqlite_size_bytes"],
        "schema_version": SCHEMA_VERSION,
    }


def write_meta_json(meta_path: Path, stats: dict[str, object]) -> None:
    """Write the build metadata JSON used by the app's About screen."""
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(build_meta_document(stats), ensure_ascii=False, indent=2)
    meta_path.write_text(payload + "\n", encoding="utf-8")


def validate_dump_date(value: str) -> str:
    """Validate a YYYY-MM-DD dump date."""
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("dump date must be YYYY-MM-DD") from exc
    return value


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the Rewiaty offline Arabic Wiktionary dictionary (F49).",
    )
    parser.add_argument("--input", type=Path, help="path to the .xml.bz2 dump")
    parser.add_argument(
        "--download",
        action="store_true",
        help="download the pinned (dated) dump into --cache-dir when --input is omitted",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".cache/arwiktionary"),
        help="cache directory used by --download (default: .cache/arwiktionary)",
    )
    parser.add_argument("--output", type=Path, required=True, help="SQLite output path")
    parser.add_argument("--meta-out", type=Path, help="optional metadata JSON output path")
    parser.add_argument(
        "--meta-in",
        type=Path,
        help=(
            "pinned metadata used for the dump URL/date and SHA-256 pin "
            f"(default: {DEFAULT_META_IN} when present)"
        ),
    )
    parser.add_argument(
        "--verify-sha256",
        help="require the dump to match this hex SHA-256 before building",
    )
    parser.add_argument(
        "--allow-unverified",
        action="store_true",
        help=(
            "allow a build without a SHA-256 pin; ONLY for local experiments and "
            "synthetic test dumps, never for a distributed build"
        ),
    )
    parser.add_argument(
        "--dump-date",
        type=validate_dump_date,
        default=None,
        help=(
            "date of the dump, YYYY-MM-DD (default: derived from the dump filename, "
            f"else {DEFAULT_DUMP_DATE})"
        ),
    )
    args = parser.parse_args(argv)
    if args.input is not None and args.download:
        parser.error("--input and --download are mutually exclusive")
    return args


def resolve_pinned_meta(args: argparse.Namespace) -> dict[str, object]:
    """The pinned metadata document, defaulting to `scripts/dictionary-meta.json`."""
    meta_in = args.meta_in
    if meta_in is None and DEFAULT_META_IN.is_file():
        meta_in = DEFAULT_META_IN
    return load_pinned_meta(meta_in)


def resolve_dump_date(args: argparse.Namespace, pinned: dict[str, object], input_path: Path) -> str:
    """Dump date: explicit flag, then the filename, then the pinned meta, then default."""
    from_filename = dump_date_from_filename(input_path)
    if from_filename:
        return from_filename
    if args.dump_date:
        return str(args.dump_date)
    pinned_date = pinned.get("dump_date")
    if isinstance(pinned_date, str) and pinned_date:
        return pinned_date
    return DEFAULT_DUMP_DATE


def resolve_pinned_sha256(args: argparse.Namespace, pinned: dict[str, object]) -> str | None:
    """The SHA-256 the dump must match: explicit flag, else the pinned metadata."""
    if args.verify_sha256:
        return str(args.verify_sha256)
    pinned_sha = pinned.get("dump_sha256")
    if isinstance(pinned_sha, str) and pinned_sha:
        return pinned_sha
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        pinned = resolve_pinned_meta(args)
        expected_sha256 = resolve_pinned_sha256(args, pinned)

        if expected_sha256 is None and not args.allow_unverified:
            raise DictionaryBuildError(
                "refusing to build without a SHA-256 pin: pass --verify-sha256, "
                f"provide {DEFAULT_META_IN} with dump_sha256, or (local experiments "
                "only) --allow-unverified"
            )

        input_path = args.input
        if input_path is None:
            # Without --input, --download is the only way to obtain a dump, so a
            # missing flag is a usage error rather than a silent download.
            if not args.download:
                raise DictionaryBuildError(
                    "either --input or --download is required"
                )
            download_date = args.dump_date or str(pinned.get("dump_date") or DEFAULT_DUMP_DATE)
            source_url = dump_url_for_date(download_date)
            print(f"Downloading {source_url} into {args.cache_dir} ...", file=sys.stderr)
            input_path = download_dump(args.cache_dir, source_url)

        dump_date = resolve_dump_date(args, pinned, Path(input_path))
        stats = build_dictionary_db(
            input_path,
            args.output,
            dump_date=dump_date,
            meta_out=args.meta_out,
            verify_sha256=expected_sha256,
        )
    except DictionaryBuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(
        "Built dictionary in {elapsed_seconds}s: entries={entry_count}, "
        "size={sqlite_size_bytes} bytes, sha256={dump_sha256}".format(**stats)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
