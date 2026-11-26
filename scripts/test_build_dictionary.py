#!/usr/bin/env python3
"""Unit tests for the reproducible offline dictionary builder (F49).

The fixtures are synthetic wiki pages written here on the fly — no real
Wiktionary dump, no book text, and no generated SQLite file is ever committed.
"""

from __future__ import annotations

import bz2
import hashlib
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

# The builder intentionally lives at `scripts/build-dictionary.py` (hyphenated),
# so load it by path instead of importing a module name.
_BUILD_SCRIPT = Path(__file__).resolve().parent / "build-dictionary.py"
_SPEC = importlib.util.spec_from_file_location("build_dictionary", _BUILD_SCRIPT)
if _SPEC is None or _SPEC.loader is None:  # pragma: no cover - defensive
    raise ImportError(f"cannot load {_BUILD_SCRIPT}")
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules["build_dictionary"] = _MODULE
_SPEC.loader.exec_module(_MODULE)

from build_dictionary import (  # noqa: E402
    DEFAULT_DUMP_DATE,
    DictionaryBuildError,
    SOURCE_URL,
    build_dictionary_db,
    build_meta_document,
    dump_date_from_filename,
    dump_url_for_date,
    extract_arabic_section,
    extract_definitions,
    extract_pos,
    extract_root,
    main as build_main,
    normalize_ar,
    normalize_entry_word,
    strip_wiki_markup,
)

MEDIAWIKI_HEADER = """<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">
"""

MEDIAWIKI_FOOTER = "</mediawiki>\n"


def page(title: str, text: str, namespace: str = "0") -> str:
    return (
        "  <page>\n"
        f"    <title>{title}</title>\n"
        f"    <ns>{namespace}</ns>\n"
        "    <revision>\n"
        f"      <text>{text}</text>\n"
        "    </revision>\n"
        "  </page>\n"
    )


# 1. Standard "#" definitions, a POS heading and a root template.
PAGE_HASH_DEFS = page(
    "كِتَاب",
    """
== {{اللغة|عربية}} ==
{{جذر|ك ت ب}}
=== اسم ===
# وعاء من أوراق تُقرأ.
# مجموع ما كُتب من صفحات.
#: مثال توضيحي لا يُحتسب.
== {{اللغة|إنجليزية}} ==
{{-en-}}
=== Noun ===
# book
""",
)

# 2. No "#" lines: prose/bullets under "=== المعاني ===" (Pass 2).
PAGE_MEANING_PROSE = page(
    "مِدْرَاسَة",
    """
== {{-ar-}} ==
=== المعاني ===
* مكان يُتعلَّم فيه.
بيت من بيوت العلم.
{{تصنيف|مدارس}}
""",
)

# 3. Disambiguation page: "{{توضيح}}" means no entry at all.
PAGE_DISAMBIGUATION = page(
    "شَمْس",
    """
== {{اللغة|عربية}} ==
{{توضيح}}
=== اسم ===
# اسم لكوكب مضيء.
""",
)

# 4. Arabic title but no Arabic section.
PAGE_NO_ARABIC_SECTION = page(
    "قَمَر",
    """
== {{اللغة|إنجليزية}} ==
=== Noun ===
# moon
""",
)

# 5. Multi-word titles and titles with a namespace prefix are not headwords.
PAGE_MULTI_WORD = page(
    "بَيْت الشَّعْر",
    """
== {{اللغة|عربية}} ==
=== اسم ===
# خيمة من شعر.
""",
)
PAGE_NAMESPACED = page(
    "بَاب:نَحْو",
    """
== {{اللغة|عربية}} ==
=== اسم ===
# صفحة تصنيف نحوي.
""",
)

# 6. Only a stop heading ("ترجمات") with bullet content: nothing to keep.
PAGE_ONLY_TRANSLATIONS = page(
    "نَهْر",
    """
== {{اللغة|عربية}} ==
=== ترجمات ===
* river
""",
)

# 7. Plain "== العربية ==" heading form.
PAGE_PLAIN_ARABIC_HEADING = page(
    "بَحْر",
    """
== العربية ==
=== اسم ===
# مسطح مائي كبير ومالح.
""",
)

# 8. A hyphenated title normalizes to two Arabic letters, exactly like the app:
#    the TS stemmer drops "-" so the lookup key is "اب", not "ا-ب".
PAGE_HYPHENATED = page(
    "أ-ب",
    """
== {{اللغة|عربية}} ==
=== اسم ===
# تعريفٌ مركّب بشرطة.
""",
)

# 9. A one-letter title is never queried by the app, so it is never stored.
PAGE_SINGLE_LETTER = page(
    "ب",
    """
== {{اللغة|عربية}} ==
=== حرف ===
# حرف جرّ.
""",
)


def build_fixture_dump(path: Path) -> None:
    xml = (
        MEDIAWIKI_HEADER
        + PAGE_HASH_DEFS
        + PAGE_MEANING_PROSE
        + PAGE_DISAMBIGUATION
        + PAGE_NO_ARABIC_SECTION
        + PAGE_MULTI_WORD
        + PAGE_NAMESPACED
        + PAGE_ONLY_TRANSLATIONS
        + PAGE_PLAIN_ARABIC_HEADING
        + PAGE_HYPHENATED
        + PAGE_SINGLE_LETTER
        + MEDIAWIKI_FOOTER
    )
    with bz2.open(path, "wb") as handle:
        handle.write(xml.encode("utf-8"))


def build_truncated_dump(path: Path) -> None:
    """A *valid* bz2 stream holding truncated XML (triggers `ET.ParseError`)."""
    xml = (
        MEDIAWIKI_HEADER
        + PAGE_HASH_DEFS
        + PAGE_MEANING_PROSE
        + PAGE_PLAIN_ARABIC_HEADING
        # no MEDIAWIKI_FOOTER: the root element is never closed.
    )
    with bz2.open(path, "wb") as handle:
        handle.write(xml.encode("utf-8"))


class NormalizeAndMarkupTests(unittest.TestCase):
    def test_normalize_ar_folds_orthographic_variants(self) -> None:
        self.assertEqual(normalize_ar("كِتَابٌ"), "كتاب")
        self.assertEqual(normalize_ar("أَحْمَد"), "احمد")
        self.assertEqual(normalize_ar("إِسْم"), "اسم")
        self.assertEqual(normalize_ar("آدَم"), "ادم")
        self.assertEqual(normalize_ar("ٱلْيَوْم"), "اليوم")
        self.assertEqual(normalize_ar("مُوسَى"), "موسي")
        self.assertEqual(normalize_ar("مَدْرَسَة"), "مدرسه")
        self.assertEqual(normalize_ar("مُؤْمِن"), "مومن")
        self.assertEqual(normalize_ar("شَاطِئ"), "شاطي")
        self.assertEqual(normalize_ar(" كَـاتِب "), "كاتب")

    def test_normalize_ar_strips_punctuation_like_the_ts_stemmer(self) -> None:
        # `apps/mobile/src/storage/arabic-stemmer.ts` removes everything outside
        # U+0621..U+064A, so the builder must produce the same key or lookups miss.
        self.assertEqual(normalize_ar("أ-ب"), "اب")
        self.assertEqual(normalize_ar("كِتَابٌ،؟!."), "كتاب")
        self.assertEqual(normalize_ar("«مَدْرَسَةٌ»"), "مدرسه")
        self.assertEqual(normalize_ar("2019"), "")
        self.assertEqual(normalize_ar("book"), "")

    def test_normalize_entry_word_rejects_one_letter_words(self) -> None:
        # A one-letter headword is rejected by the app before it ever queries.
        self.assertIsNone(normalize_entry_word("ب"))
        self.assertIsNone(normalize_entry_word("ب-"))
        self.assertIsNone(normalize_entry_word("1234"))
        self.assertEqual(normalize_entry_word("أ-ب"), "اب")
        self.assertEqual(normalize_entry_word("كِتَاب"), "كتاب")

    def test_strip_wiki_markup_keeps_text_only(self) -> None:
        self.assertEqual(
            strip_wiki_markup("[[بيت|منزل]] '''كبير''' <!-- تعليق -->"),
            "منزل كبير",
        )
        self.assertEqual(
            strip_wiki_markup("ماء<ref>مصدر</ref> و[[تصنيف:مياه]]"),
            "ماء و",
        )
        self.assertEqual(strip_wiki_markup("{{مثال}} نص&nbsp;نظيف"), "نص نظيف")


class SectionExtractionTests(unittest.TestCase):
    def test_extracts_arabic_section_for_all_three_heading_forms(self) -> None:
        for heading in ("== {{اللغة|عربية}} ==", "== {{-ar-}} ==", "== العربية =="):
            section = extract_arabic_section(f"{heading}\nسطر\n== x ==\nأخرى")
            self.assertIsNotNone(section)
            assert section is not None
            self.assertIn("سطر", section)
            self.assertNotIn("أخرى", section)

    def test_returns_none_without_arabic_section(self) -> None:
        self.assertIsNone(extract_arabic_section("== {{اللغة|إنجليزية}} ==\n# book"))

    def test_extracts_pos_and_root(self) -> None:
        section = "{{جذر|ك ت ب}}\n=== اسم ===\n# كتاب"
        self.assertEqual(extract_root(section), "ك ت ب")
        self.assertEqual(extract_pos(section), "اسم")

    def test_root_falls_back_to_category(self) -> None:
        section = "[[تصنيف:ك ت ب]]\n=== فعل ===\n# كتب"
        self.assertEqual(extract_root(section), "ك ت ب")


class DefinitionExtractionTests(unittest.TestCase):
    def test_hash_definitions_skip_nested_examples(self) -> None:
        section = extract_arabic_section(PAGE_HASH_DEFS)
        assert section is not None
        definitions = extract_definitions(section)
        self.assertEqual(
            definitions,
            ["وعاء من أوراق تُقرأ.", "مجموع ما كُتب من صفحات."],
        )

    def test_meaning_section_prose_and_bullets(self) -> None:
        section = extract_arabic_section(PAGE_MEANING_PROSE)
        assert section is not None
        definitions = extract_definitions(section)
        self.assertEqual(definitions, ["مكان يُتعلَّم فيه.", "بيت من بيوت العلم."])

    def test_disambiguation_pages_are_skipped(self) -> None:
        section = extract_arabic_section(PAGE_DISAMBIGUATION)
        assert section is not None
        self.assertEqual(extract_definitions(section), [])

    def test_stop_headings_do_not_produce_definitions(self) -> None:
        section = extract_arabic_section(PAGE_ONLY_TRANSLATIONS)
        assert section is not None
        self.assertEqual(extract_definitions(section), [])


class BuildDictionaryDbTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.dump_path = self.root / "fixture.xml.bz2"
        self.db_path = self.root / "fixture.sqlite"
        self.meta_path = self.root / "fixture-meta.json"
        build_fixture_dump(self.dump_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_builds_deterministic_schema_and_meta(self) -> None:
        stats = build_dictionary_db(
            self.dump_path,
            self.db_path,
            dump_date="2026-11-01",
            meta_out=self.meta_path,
        )

        self.assertTrue(self.db_path.is_file())
        self.assertEqual(stats["entry_count"], 4)

        connection = sqlite3.connect(str(self.db_path))
        try:
            columns = [row[1] for row in connection.execute("PRAGMA table_info(entries)")]
            self.assertEqual(
                columns,
                ["id", "word", "norm", "pos", "root", "defs"],
            )
            indexes = [row[1] for row in connection.execute("PRAGMA index_list(entries)")]
            self.assertIn("idx_entries_norm", indexes)

            rows = list(
                connection.execute(
                    "SELECT word, norm, pos, root, defs FROM entries ORDER BY id"
                )
            )
            self.assertEqual(
                rows,
                [
                    ("كِتَاب", "كتاب", "اسم", "ك ت ب", "وعاء من أوراق تُقرأ.\nمجموع ما كُتب من صفحات."),
                    ("مِدْرَاسَة", "مدراسه", None, None, "مكان يُتعلَّم فيه.\nبيت من بيوت العلم."),
                    ("بَحْر", "بحر", "اسم", None, "مسطح مائي كبير ومالح."),
                    ("أ-ب", "اب", "اسم", None, "تعريفٌ مركّب بشرطة."),
                ],
            )

            meta = dict(connection.execute("SELECT key, value FROM meta"))
            self.assertEqual(meta["source"], "arwiktionary")
            self.assertEqual(meta["license"], "CC BY-SA 4.0")
            self.assertEqual(
                meta["license_url"], "https://creativecommons.org/licenses/by-sa/4.0/"
            )
            self.assertIn("مساهمي ويكاموس العربي", meta["attribution"])
            self.assertEqual(meta["dump_date"], "2026-11-01")
            self.assertEqual(
                meta["source_url"],
                "https://dumps.wikimedia.org/arwiktionary/20261101/"
                "arwiktionary-20261101-pages-articles.xml.bz2",
            )
            self.assertEqual(
                meta["dump_sha256"], hashlib.sha256(self.dump_path.read_bytes()).hexdigest()
            )
            self.assertEqual(meta["entry_count"], "4")
            self.assertEqual(meta["schema_version"], "1")
        finally:
            connection.close()

        meta_document = json.loads(self.meta_path.read_text(encoding="utf-8"))
        self.assertEqual(meta_document["source"], "arwiktionary")
        self.assertEqual(meta_document["license"], "CC BY-SA 4.0")
        self.assertEqual(meta_document["entry_count"], 4)
        self.assertEqual(meta_document["dump_date"], "2026-11-01")
        self.assertEqual(
            meta_document["source_url"],
            "https://dumps.wikimedia.org/arwiktionary/20261101/"
            "arwiktionary-20261101-pages-articles.xml.bz2",
        )

    def test_skips_disambiguation_non_arabic_and_multi_word_pages(self) -> None:
        build_dictionary_db(self.dump_path, self.db_path, dump_date="2026-11-01")

        connection = sqlite3.connect(str(self.db_path))
        try:
            words = {row[0] for row in connection.execute("SELECT word FROM entries")}
        finally:
            connection.close()

        self.assertNotIn("شَمْس", words)
        self.assertNotIn("قَمَر", words)
        self.assertNotIn("بَيْت الشَّعْر", words)
        self.assertNotIn("بَاب:نَحْو", words)
        self.assertNotIn("نَهْر", words)
        # A one-letter headword is not an entry: the app never looks it up.
        self.assertNotIn("ب", words)

    def test_hyphenated_title_is_stored_under_the_stemmer_key(self) -> None:
        build_dictionary_db(self.dump_path, self.db_path, dump_date="2026-11-01")

        connection = sqlite3.connect(str(self.db_path))
        try:
            norms = {row[0] for row in connection.execute("SELECT norm FROM entries")}
        finally:
            connection.close()

        # Exactly what `normalizeArabicWord('أ-ب')` returns in the app.
        self.assertIn("اب", norms)
        self.assertNotIn("ا-ب", norms)

    def test_accepts_matching_sha256(self) -> None:
        expected = hashlib.sha256(self.dump_path.read_bytes()).hexdigest()
        stats = build_dictionary_db(
            self.dump_path,
            self.db_path,
            dump_date="2026-11-01",
            verify_sha256=expected,
        )
        self.assertEqual(stats["dump_sha256"], expected)
        self.assertTrue(self.db_path.is_file())

    def test_rejects_sha256_mismatch_before_writing(self) -> None:
        with self.assertRaises(DictionaryBuildError):
            build_dictionary_db(
                self.dump_path,
                self.db_path,
                dump_date="2026-11-01",
                verify_sha256="0" * 64,
            )
        self.assertFalse(self.db_path.exists())

    def test_rebuild_is_byte_identical(self) -> None:
        first = self.root / "first.sqlite"
        second = self.root / "second.sqlite"
        build_dictionary_db(self.dump_path, first, dump_date="2026-11-01")
        build_dictionary_db(self.dump_path, second, dump_date="2026-11-01")
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_missing_input_raises(self) -> None:
        with self.assertRaises(DictionaryBuildError):
            build_dictionary_db(
                self.root / "missing.xml.bz2",
                self.db_path,
                dump_date="2026-11-01",
            )

    def test_parse_error_leaves_the_previous_database_untouched(self) -> None:
        # Publish a good build first, then feed a truncated dump into the same
        # output path: the old file must survive byte for byte.
        build_dictionary_db(self.dump_path, self.db_path, dump_date="2026-11-01")
        original_bytes = self.db_path.read_bytes()
        self.assertGreater(len(original_bytes), 0)

        broken_dump = self.root / "first-broken.xml.bz2"
        build_truncated_dump(broken_dump)

        with self.assertRaises(ET.ParseError):
            build_dictionary_db(
                broken_dump,
                self.db_path,
                dump_date="2026-11-01",
                meta_out=self.meta_path,
            )

        self.assertEqual(self.db_path.read_bytes(), original_bytes)
        # No half-written sibling survives the failed build.
        self.assertEqual(sorted(self.root.glob("*.tmp.*")), [])
        # The metadata document was never rewritten either.
        self.assertFalse(self.meta_path.exists())

        # The preserved file is still a valid database with its rows intact.
        connection = sqlite3.connect(str(self.db_path))
        try:
            self.assertEqual(
                connection.execute("SELECT COUNT(*) FROM entries").fetchone()[0], 4
            )
        finally:
            connection.close()

    def test_writes_through_a_temporary_sibling_then_replaces(self) -> None:
        stats = build_dictionary_db(self.dump_path, self.db_path, dump_date="2026-11-01")
        self.assertEqual(stats["output"], str(self.db_path))
        self.assertEqual(sorted(self.root.glob("*.tmp.*")), [])
        self.assertTrue(self.db_path.is_file())


class PinnedDumpUrlTests(unittest.TestCase):
    """The build must pin a dated dump URL, never `/latest/`."""

    def test_dump_url_is_never_latest(self) -> None:
        self.assertNotIn("latest", SOURCE_URL)
        self.assertNotIn("latest", dump_url_for_date(DEFAULT_DUMP_DATE))
        self.assertEqual(
            dump_url_for_date("2026-11-01"),
            "https://dumps.wikimedia.org/arwiktionary/20261101/"
            "arwiktionary-20261101-pages-articles.xml.bz2",
        )
        self.assertEqual(
            dump_url_for_date("20261205"),
            "https://dumps.wikimedia.org/arwiktionary/20261205/"
            "arwiktionary-20261205-pages-articles.xml.bz2",
        )

    def test_dump_url_rejects_a_bad_date(self) -> None:
        for bad in ("latest", "2026-11", "202611010"):
            with self.assertRaises(DictionaryBuildError):
                dump_url_for_date(bad)

    def test_committed_metadata_pins_the_dated_dump(self) -> None:
        meta_path = Path(__file__).resolve().parent / "dictionary-meta.json"
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
        self.assertEqual(
            payload["source_url"],
            "https://dumps.wikimedia.org/arwiktionary/20261101/"
            "arwiktionary-20261101-pages-articles.xml.bz2",
        )
        self.assertNotIn("latest", payload["source_url"])
        self.assertEqual(len(payload["dump_sha256"]), 64)

    def test_dump_date_is_derived_from_the_filename(self) -> None:
        self.assertEqual(
            dump_date_from_filename("arwiktionary-20261101-pages-articles.xml.bz2"),
            "2026-11-01",
        )
        self.assertEqual(
            dump_date_from_filename("/tmp/arwiktionary-20200102-pages.xml.bz2"),
            "2020-01-02",
        )
        self.assertIsNone(dump_date_from_filename("fixture.xml.bz2"))
        self.assertIsNone(dump_date_from_filename("arwiktionary-99999999-pages.xml.bz2"))

    def test_meta_document_carries_the_pinned_url(self) -> None:
        document = build_meta_document(
            {
                "entry_count": 1,
                "sqlite_size_bytes": 10,
                "dump_sha256": "a" * 64,
                "dump_date": "2026-11-01",
                "source_url": dump_url_for_date("2026-11-01"),
            }
        )
        self.assertEqual(document["source_url"], dump_url_for_date("2026-11-01"))
        self.assertNotIn("latest", str(document["source_url"]))


class CliSha256EnforcementTests(unittest.TestCase):
    """`main()` refuses an unverified download or distributed build."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.dump_path = self.root / "arwiktionary-20261101-pages-articles.xml.bz2"
        self.db_path = self.root / "out.sqlite"
        self.meta_out = self.root / "out-meta.json"
        self.no_pin = self.root / "no-such-meta.json"
        build_fixture_dump(self.dump_path)
        self.dump_sha256 = hashlib.sha256(self.dump_path.read_bytes()).hexdigest()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_download_without_a_pin_is_refused(self) -> None:
        code = build_main(
            [
                "--download",
                "--meta-in",
                str(self.no_pin),
                "--cache-dir",
                str(self.root / "cache"),
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 1)
        self.assertFalse(self.db_path.exists())
        self.assertFalse((self.root / "cache").exists())

    def test_distributed_build_without_a_pin_is_refused(self) -> None:
        code = build_main(
            [
                "--input",
                str(self.dump_path),
                "--meta-in",
                str(self.no_pin),
                "--meta-out",
                str(self.meta_out),
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 1)
        self.assertFalse(self.db_path.exists())
        self.assertFalse(self.meta_out.exists())

    def test_allow_unverified_is_the_only_escape_hatch(self) -> None:
        code = build_main(
            [
                "--input",
                str(self.dump_path),
                "--meta-in",
                str(self.no_pin),
                "--allow-unverified",
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 0)
        self.assertTrue(self.db_path.is_file())

    def test_pinned_meta_sha256_is_enforced(self) -> None:
        pinned = self.root / "pinned.json"
        pinned.write_text(
            json.dumps(
                {
                    "source_url": dump_url_for_date("2026-11-01"),
                    "dump_date": "2026-11-01",
                    "dump_sha256": self.dump_sha256,
                }
            ),
            encoding="utf-8",
        )

        code = build_main(
            [
                "--input",
                str(self.dump_path),
                "--meta-in",
                str(pinned),
                "--meta-out",
                str(self.meta_out),
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 0)
        self.assertTrue(self.db_path.is_file())
        document = json.loads(self.meta_out.read_text(encoding="utf-8"))
        self.assertEqual(document["dump_sha256"], self.dump_sha256)
        # The date comes from the filename, not from a default/today.
        self.assertEqual(document["dump_date"], "2026-11-01")
        self.assertEqual(document["source_url"], dump_url_for_date("2026-11-01"))

    def test_mismatched_sha256_is_refused_and_keeps_the_old_output(self) -> None:
        build_dictionary_db(self.dump_path, self.db_path, dump_date="2026-11-01")
        original = self.db_path.read_bytes()

        code = build_main(
            [
                "--input",
                str(self.dump_path),
                "--meta-in",
                str(self.no_pin),
                "--verify-sha256",
                "0" * 64,
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 1)
        self.assertEqual(self.db_path.read_bytes(), original)

    def test_filename_date_wins_over_a_mismatched_flag(self) -> None:
        code = build_main(
            [
                "--input",
                str(self.dump_path),
                "--meta-in",
                str(self.no_pin),
                "--allow-unverified",
                "--dump-date",
                "2020-01-01",
                "--meta-out",
                str(self.meta_out),
                "--output",
                str(self.db_path),
            ]
        )
        self.assertEqual(code, 0)
        document = json.loads(self.meta_out.read_text(encoding="utf-8"))
        self.assertEqual(document["dump_date"], "2026-11-01")
        self.assertEqual(document["source_url"], dump_url_for_date("2026-11-01"))


if __name__ == "__main__":
    unittest.main()
