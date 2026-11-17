from __future__ import annotations

from collections import Counter
from io import BytesIO
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

from docx import Document
from lxml import etree as ET

from xrs_anonymizer.batch import BatchError, Session, discover, require_local, run_batch
from xrs_anonymizer.core import Blocked, Rebuilder, Q, W, R, REL, NS, parse, process, read_package, verify, xml
from xrs_anonymizer.redact import service_date_spans
from .fixtures import minimal, rich_fixture, unpack, write


class AnonymizerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "input"
        self.source.mkdir()
        self.output = self.root / "output"

    def tearDown(self):
        self.temp.cleanup()

    def run_parts(self, parts, name="synthetic.docx"):
        return process(write(self.source / name, parts), "CASE-000001")

    def text(self, blob):
        return "\n".join("".join(parse(data).itertext(Q("t"))) for name, data in unpack(blob).items() if name.startswith("word/") and name.endswith(".xml") and not name.endswith(".rels"))

    def test_01_full_patient_and_doctor_names(self):
        for text in ["Ф.И.О. пациента: Иванов Иван Иванович", "Врач: Петров Пётр Петрович", "Иванов Иван Иванович"]:
            with self.subTest(text=text):
                result, blob = self.run_parts(minimal(text))
                self.assertEqual(result.status, "PASS", result)
                self.assertNotIn("Иванов", self.text(blob))
                self.assertNotIn("Петров", self.text(blob))

    def test_02_initials_filename_and_original_unchanged(self):
        path = write(self.source / "Иванов И.И. 16.10.1973.docx", minimal("Иванов И. И. Очаг 5 мм."))
        original = path.read_bytes()
        run_batch(self.source, self.output)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual([p.name for p in (self.output / "Anonymized").glob("*.docx")], ["CASE-000001.docx"])
        reports = (self.output / "Reports" / "summary.json").read_text()
        self.assertNotIn("Иванов", reports)
        self.assertNotIn("1973", reports)

    def test_03_birth_study_dates_and_number(self):
        for text in ["Дата рождения: 16.10.1973", "Дата исследования: 17.11.2026", "Протокол МРТ №18415"]:
            result, blob = self.run_parts(minimal(text + "\nОчаг 5 мм."))
            self.assertEqual(result.status, "PASS", result)
            for secret in ["1973", "2026", "18415"]:
                self.assertNotIn(secret, self.text(blob))

    def test_04_cross_run_match_preserves_formatting(self):
        parts = minimal("")
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        p.clear()
        for i, text in enumerate(["Ф.И.О. пациента: Ива", "нов Иван ", "Иванович"]):
            run = ET.SubElement(p, Q("r"))
            if i == 0:
                ET.SubElement(ET.SubElement(run, Q("rPr")), Q("b"))
            ET.SubElement(run, Q("t")).text = text
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertNotIn("Ива", self.text(blob))
        self.assertIn(b"<ns0:b", unpack(blob)["word/document.xml"])

    def test_05_images_tables_headers_footer_and_real_docx_open(self):
        path = rich_fixture(self.source / "synthetic.docx")
        result, blob = process(path, "CASE-000001")
        self.assertEqual(result.status, "PASS", result)
        parts = unpack(blob)
        self.assertGreaterEqual(result.removed_images, 2)
        self.assertFalse(any("media" in name for name in parts))
        output = Document(BytesIO(blob))
        self.assertEqual(output.tables[0].cell(0, 1).text, "[УДАЛЕНО]")
        self.assertEqual(output.tables[0].cell(1, 1).text, "12 × 8 мм")
        self.assertIn("[УДАЛЕНО]", output.sections[0].header.paragraphs[0].text)
        self.assertIn("Заключение", output.sections[0].footer.paragraphs[0].text)
        for secret in ["Иванов", "Петров", "Сидоров", "СЕКРЕТ_АВТОР", "СЕКРЕТ_РЕДАКТОР", "18415", "1973"]:
            self.assertFalse(any(secret.encode() in data for data in parts.values()), secret)

    def test_06_comments_revisions_hidden_and_fields(self):
        parts = minimal("Очаг 12 мм.")
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        for tag in ["del", "moveFrom"]:
            change = ET.SubElement(p, Q(tag), {Q("author"): "СЕКРЕТ_АВТОР"})
            ET.SubElement(ET.SubElement(change, Q("r")), Q("delText")).text = "СЕКРЕТ_УДАЛЁННЫЙ"
        inserted = ET.SubElement(p, Q("ins"), {Q("author"): "СЕКРЕТ_АВТОР"})
        ET.SubElement(ET.SubElement(inserted, Q("r")), Q("t")).text = " T2 справа."
        run = ET.SubElement(p, Q("r"))
        ET.SubElement(ET.SubElement(run, Q("rPr")), Q("vanish"))
        ET.SubElement(run, Q("t")).text = "СЕКРЕТ_СКРЫТЫЙ"
        run = ET.SubElement(p, Q("r"))
        ET.SubElement(run, Q("instrText")).text = "INCLUDETEXT СЕКРЕТ_ПУТЬ"
        field_result = ET.SubElement(p, Q("r"))
        ET.SubElement(field_result, Q("fldChar"), {Q("fldCharType"): "begin"})
        ET.SubElement(field_result, Q("t")).text = "Дата проведения: 22.02.2022"
        ET.SubElement(field_result, Q("fldChar"), {Q("fldCharType"): "end"})
        ET.SubElement(p, Q("commentRangeStart"), {Q("id"): "4"})
        parts["word/document.xml"] = xml(root)
        parts["word/comments.xml"] = b"<secret>SECRET_COMMENT</secret>"
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertIn("T2 справа", self.text(blob))
        for data in unpack(blob).values():
            self.assertNotIn("СЕКРЕТ".encode(), data)
            self.assertNotIn(b"SECRET_COMMENT", data)
            self.assertNotIn("22.02.2022".encode(), data)

    def test_07_hidden_inherited_style(self):
        parts = minimal("СЕКРЕТ_СКРЫТЫЙ")
        root = parse(parts["word/document.xml"])
        r = root.find(".//w:r", NS)
        props = ET.Element(Q("rPr"))
        ET.SubElement(props, Q("rStyle"), {Q("val"): "PRIVATE_STYLE"})
        r.insert(0, props)
        parts["word/document.xml"] = xml(root)
        styles = ET.Element(Q("styles"))
        parent = ET.SubElement(styles, Q("style"), {Q("styleId"): "HIDDEN"})
        ET.SubElement(ET.SubElement(parent, Q("rPr")), Q("vanish"))
        child = ET.SubElement(styles, Q("style"), {Q("styleId"): "PRIVATE_STYLE"})
        ET.SubElement(child, Q("basedOn"), {Q("val"): "HIDDEN"})
        parts["word/styles.xml"] = xml(styles)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "REVIEW")  # no visible clinical content left
        self.assertNotIn("СЕКРЕТ", self.text(blob))
        self.assertNotIn(b"PRIVATE_STYLE", b"".join(unpack(blob).values()))

    def test_08_eponyms_and_measurements(self):
        text = "Грыжа Шморля. Болезнь Бехтерева. Киста Бейкера. Modic II, Pfirrmann III, BI-RADS 2. Очаг 12 × 8 × 4,5 мм; ADC 0,9 × 10⁻³ мм²/с; L4-L5, T1/T2, справа."
        result, blob = self.run_parts(minimal(text))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(self.text(blob), text)

    def test_09_corrupted_and_unknown_parts_block(self):
        path = self.source / "bad.docx"
        path.write_bytes(b"not a zip")
        self.assertEqual(process(path, "CASE-000001")[0].reason, "INVALID_ZIP")
        parts = minimal()
        parts["unknown/opaque.dat"] = b"SECRET"
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "BLOCKED")
        self.assertIsNone(blob)

    def test_10_large_batch_thousand_and_repeat_no_clobber(self):
        template = self.source / "template.tmp"
        write(template, minimal())
        data = template.read_bytes()
        for number in range(1000):
            (self.source / f"synthetic-{number:04d}.docx").write_bytes(data)
        counts = run_batch(self.source, self.output)
        self.assertEqual(counts["PASS"], 1000)
        first = self.output / "Anonymized" / "CASE-000001.docx"
        before = first.read_bytes()
        # Repeat one document without reprocessing the already completed 1000.
        second_source = self.root / "input2"
        second_source.mkdir()
        (second_source / "synthetic.docx").write_bytes(data)
        run_batch(second_source, self.output)
        self.assertEqual(before, first.read_bytes())
        self.assertTrue((self.output / "Anonymized" / "CASE-001001.docx").exists())
        self.assertTrue((self.output / "Reports" / "run-000002.json").exists())

    def test_11_no_network_or_dns_calls(self):
        write(self.source / "synthetic.docx", minimal("Ф.И.О. пациента: Иванов Иван Иванович"))
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden")) as connect, \
             patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden")) as create, \
             patch.object(socket, "getaddrinfo", side_effect=AssertionError("DNS forbidden")) as dns:
            counts = run_batch(self.source, self.output)
        self.assertEqual(counts["PASS"], 1)
        connect.assert_not_called()
        create.assert_not_called()
        dns.assert_not_called()

    def test_12_metadata_customxml_ole_external_links(self):
        parts = minimal("Очаг 5 мм.")
        parts.update({"docProps/core.xml": b"<x>SECRET_AUTHOR</x>",
                      "docProps/custom.xml": b"<x>SECRET_PROPERTY</x>",
                      "customXml/item1.xml": b"<x>SECRET_CUSTOMXML</x>",
                      "word/embeddings/oleObject1.bin": b"SECRET_EMBEDDED",
                      "word/media/orphan.svg": b"SECRET_SVG",
                      "word/media/orphan.wmf": b"SECRET_WMF"})
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        hyperlink = ET.SubElement(p, Q("hyperlink"), {f"{{{R}}}id": "rId99"})
        ET.SubElement(ET.SubElement(hyperlink, Q("r")), Q("t")).text = " клинический текст"
        obj = ET.SubElement(ET.SubElement(p, Q("r")), Q("object"))
        ET.SubElement(obj, "{urn:schemas-microsoft-com:office:office}OLEObject")
        parts["word/document.xml"] = xml(root)
        rel = ET.Element(f"{{{REL}}}Relationships")
        ET.SubElement(rel, f"{{{REL}}}Relationship", Id="rId99", Type=R+"/hyperlink", Target="https://patient.invalid/SECRET_LINK", TargetMode="External")
        parts["word/_rels/document.xml.rels"] = xml(rel)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertIn("клинический текст", self.text(blob))
        self.assertNotIn(b"SECRET", b"".join(unpack(blob).values()))
        self.assertTrue(verify(unpack(blob)) == set())

    def test_13_ambiguous_review_isolation(self):
        write(self.source / "synthetic.docx", minimal("Сравнение от 11.12.2024. Иванов Иван."))
        counts = run_batch(self.source, self.output)
        self.assertEqual(counts["REVIEW"], 1)
        self.assertEqual(list((self.output / "Anonymized").glob("*.docx")), [])
        self.assertEqual(len(list((self.output / "Review").glob("*.docx"))), 1)

    def test_14_blocked_not_written_and_safe_reports(self):
        (self.source / "Иванов SECRET.docx").write_bytes(b"bad zip SECRET")
        counts = run_batch(self.source, self.output)
        self.assertEqual(counts["BLOCKED"], 1)
        self.assertEqual(list(self.output.rglob("*.docx")), [])
        for path in (self.output / "Reports").iterdir():
            text = path.read_text(encoding="utf-8-sig")
            self.assertNotIn("Иванов", text)
            self.assertNotIn("SECRET", text)
            self.assertNotIn(str(self.source), text)

    def test_15_zip_bomb(self):
        parts = minimal()
        parts["word/media/bomb.png"] = b"0" * 1024 * 1024
        result, blob = self.run_parts(parts)
        self.assertEqual(result.reason, "ZIP_EXPANSION_LIMIT")
        self.assertIsNone(blob)

    def test_16_zip_traversal_duplicate_encryption_like(self):
        parts = minimal()
        parts["../SECRET"] = b"secret"
        self.assertEqual(self.run_parts(parts)[0].reason, "UNSAFE_ZIP_ENTRY")
        path = write(self.source / "duplicate.docx", minimal())
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with zipfile.ZipFile(path, "a") as archive:
                archive.writestr("word/document.xml", b"duplicate")
        self.assertEqual(process(path, "CASE-000001")[0].reason, "UNSAFE_ZIP_ENTRY")

    def test_17_xml_entities_and_utf16_doctype(self):
        for data in [b'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>',
                     '<!DOCTYPE foo [<!ENTITY x "SECRET">]><foo>&x;</foo>'.encode("utf-16")]:
            parts = minimal()
            parts["word/document.xml"] = data
            self.assertEqual(self.run_parts(parts)[0].reason, "XML_DTD_FORBIDDEN")

    def test_18_recursive_and_output_tree_rejected(self):
        (self.source / "nested").mkdir()
        write(self.source / "nested" / "synthetic.docx", minimal())
        self.assertEqual(len(discover(self.source, self.output)), 1)
        self.assertEqual(len(discover(self.source, self.output, False)), 0)
        with self.assertRaises(BatchError):
            discover(self.source, self.source / "results")

    def test_19_cancel_and_lock(self):
        write(self.source / "synthetic.docx", minimal())
        event = threading.Event()
        event.set()
        self.assertTrue(run_batch(self.source, self.output, cancel=event)["cancelled"])
        with Session(self.output):
            with self.assertRaises(BatchError):
                with Session(self.output):
                    pass

    def test_20_footnotes_and_endnotes(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        for kind in ["footnote", "endnote"]:
            ET.SubElement(ET.SubElement(p, Q("r")), Q(kind+"Reference"), {Q("id"): "42"})
            notes = ET.Element(Q(kind+"s"))
            note = ET.SubElement(notes, Q(kind), {Q("id"): "42"})
            ET.SubElement(ET.SubElement(ET.SubElement(note, Q("p")), Q("r")), Q("t")).text = "Врач: Петров Пётр Петрович"
            parts[f"word/{kind}s.xml"] = xml(notes)
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertNotIn("Петров", self.text(blob))
        Document(BytesIO(blob))

    def test_21_vml_textbox_text_sanitized_and_isolated(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        pict = ET.SubElement(ET.SubElement(p, Q("r")), Q("pict"))
        shape = ET.SubElement(pict, "{urn:schemas-microsoft-com:vml}shape")
        box = ET.SubElement(shape, Q("txbxContent"))
        ET.SubElement(ET.SubElement(ET.SubElement(box, Q("p")), Q("r")), Q("t")).text = "Врач: Петров Пётр Петрович Дата: 01.02.2026"
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "REVIEW", result)
        self.assertNotIn("Петров", self.text(blob))
        self.assertNotIn("01.02.2026", self.text(blob))
        self.assertNotIn(b"shape", b"".join(unpack(blob).values()))
        Document(BytesIO(blob))

    def test_22_split_by_line_break_preserves_clinical_text(self):
        parts = minimal("Врач: Петров Пётр Петрович")
        root = parse(parts["word/document.xml"])
        run = root.find(".//w:r", NS)
        ET.SubElement(run, Q("br"))
        ET.SubElement(run, Q("t")).text = "Очаг 12 мм."
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertIn("Очаг 12 мм.", self.text(blob))

    def test_23_email_phone_address_ids(self):
        text = "test@example.invalid; +7 (999) 123-45-67; 123-456-789 01; Адрес: ул. Тестовая, 5; ID пациента: 77777777"
        result, blob = self.run_parts(minimal(text))
        self.assertEqual(result.status, "PASS", result)
        for value in ["example", "999", "123", "Тестовая", "77777777"]:
            self.assertNotIn(value, self.text(blob))

    def test_24_unrecognized_text_and_malformed_structure_blocked(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        mystery = ET.SubElement(root.find(".//w:p", NS), Q("unknownContainer"))
        ET.SubElement(ET.SubElement(mystery, Q("r")), Q("t")).text = "SECRET"
        parts["word/document.xml"] = xml(root)
        self.assertEqual(self.run_parts(parts)[0].reason, "UNSUPPORTED_TEXT_CONTAINER")
        parts = minimal()
        root = parse(parts["word/document.xml"])
        ET.SubElement(root.find(".//w:r", NS), Q("p"))
        parts["word/document.xml"] = xml(root)
        self.assertEqual(self.run_parts(parts)[0].reason, "VERIFY_INVALID_STRUCTURE")

    def test_25_non_image_external_objects_removed(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        ET.SubElement(root.find(Q("body")), Q("altChunk"), {f"{{{R}}}id": "SECRET_ID"})
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "REVIEW", result)
        self.assertNotIn(b"SECRET_ID", b"".join(unpack(blob).values()))

    def test_26_metadata_in_format_attributes_does_not_survive(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        p.set(Q("rsidR"), "SECRET_RSID")
        prop = ET.Element(Q("pPr"))
        ET.SubElement(prop, Q("jc"), {Q("val"): "SECRET_PROPERTY"})
        p.insert(0, prop)
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertNotIn(b"SECRET", b"".join(unpack(blob).values()))

    def test_27_output_collision_does_not_overwrite(self):
        write(self.source / "synthetic.docx", minimal())
        (self.output / "Anonymized").mkdir(parents=True)
        existing = self.output / "Anonymized" / "CASE-000001.docx"
        existing.write_bytes(b"existing")
        run_batch(self.source, self.output)
        self.assertEqual(existing.read_bytes(), b"existing")
        self.assertTrue((self.output / "Anonymized" / "CASE-000002.docx").exists())

    def test_28_images_all_extensions_are_removed(self):
        parts = minimal()
        for ext in ["jpg", "jpeg", "png", "tiff", "bmp", "gif", "emf", "wmf", "svg"]:
            parts[f"word/media/image1.{ext}"] = b"SYNTHETIC_IMAGE"
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.removed_images, 9)
        self.assertFalse(any("media" in n for n in unpack(blob)))

    def test_29_word_numbering_and_styles_are_readable(self):
        document = Document()
        p = document.add_paragraph("Очаг 12 мм.", style="List Number")
        p.runs[0].italic = True
        path = self.source / "synthetic.docx"
        document.save(path)
        result, blob = process(path, "CASE-000001")
        self.assertEqual(result.status, "PASS", result)
        output = Document(BytesIO(blob))
        self.assertEqual(output.paragraphs[0].text, "Очаг 12 мм.")
        self.assertTrue(output.paragraphs[0].runs[0].italic)

    def test_30_second_pass_rejects_residual_identifier(self):
        parts = minimal("Врач: Иванов Иван Иванович")
        # The verifier must independently catch bypassing the redactor.
        with self.assertRaises(Blocked):
            verify(parts)

    def test_31_uppercase_names_and_initials(self):
        for text in ["ИВАНОВ ИВАН ИВАНОВИЧ", "ИВАНОВ И.И."]:
            result, blob = self.run_parts(minimal(text))
            self.assertEqual(result.status, "PASS", result)
            self.assertNotIn("ИВАНОВ", self.text(blob))

    def test_32_standalone_surname_and_latin_names_review(self):
        for text in ["Иванов", "ИВАНОВ", "John Smith", "ГБУЗ Тестовая больница"]:
            result, _ = self.run_parts(minimal(text))
            self.assertEqual(result.status, "REVIEW", result)

    def test_33_explicit_hidden_false_preserves_clinical_text(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        run = root.find(".//w:r", NS)
        prop = ET.Element(Q("rPr"))
        ET.SubElement(prop, Q("vanish"), {Q("val"): "0"})
        run.insert(0, prop)
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        self.assertIn("12 × 8 мм", self.text(blob))

    def test_34_xml_default_hidden_and_cycle(self):
        parts = minimal("СЕКРЕТ_СКРЫТЫЙ")
        styles = ET.Element(Q("styles"))
        defaults = ET.SubElement(ET.SubElement(ET.SubElement(styles, Q("docDefaults")), Q("rPrDefault")), Q("rPr"))
        ET.SubElement(defaults, Q("vanish"))
        parts["word/styles.xml"] = xml(styles)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "REVIEW", result)
        self.assertNotIn("СЕКРЕТ", self.text(blob))
        styles = ET.Element(Q("styles"))
        node = ET.SubElement(styles, Q("style"), {Q("styleId"): "a"})
        ET.SubElement(node, Q("basedOn"), {Q("val"): "a"})
        parts["word/styles.xml"] = xml(styles)
        self.assertEqual(self.run_parts(parts)[0].reason, "STYLE_INHERITANCE_CYCLE")

    def test_35_unsafe_header_target_blocks(self):
        parts = minimal()
        root = parse(parts["word/document.xml"])
        sect = ET.SubElement(root.find(Q("body")), Q("sectPr"))
        ET.SubElement(sect, Q("headerReference"), {f"{{{R}}}id": "rId99"})
        parts["word/document.xml"] = xml(root)
        rels = ET.Element(f"{{{REL}}}Relationships")
        ET.SubElement(rels, f"{{{REL}}}Relationship", Id="rId99", Type=R+"/header", Target="https://patient.invalid/SECRET", TargetMode="External")
        parts["word/_rels/document.xml.rels"] = xml(rels)
        self.assertEqual(self.run_parts(parts)[0].reason, "UNSAFE_HEADER_TARGET")

    def test_36_resource_entry_limit(self):
        parts = minimal()
        for number in range(2049):
            parts[f"word/media/{number}.png"] = b"x"
        self.assertEqual(self.run_parts(parts)[0].reason, "ZIP_ENTRY_LIMIT")

    def test_37_eponym_in_identifying_name_is_removed(self):
        for text in ["Бехтерев Иван Иванович", "Модик Иван Иванович", "Modic@example.invalid"]:
            result, blob = self.run_parts(minimal(text))
            self.assertEqual(result.status, "PASS", result)
            self.assertNotIn(text, self.text(blob))

    def test_38_study_number_example(self):
        result, blob = self.run_parts(minimal("Протокол МРТ №18415"))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(self.text(blob), "Протокол МРТ")

    def test_39_network_share_rejected_before_discovery(self):
        with self.assertRaises(BatchError):
            require_local(Path(r"\\server\share\documents"))
        with self.assertRaises(BatchError):
            require_local(Path("//server/share/documents"))

    def test_40_study_type_line_preserved_byte_for_text(self):
        line = "Область и вид исследования: МРТ левого коленного сустава"
        result, blob = self.run_parts(minimal(line))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(self.text(blob), line)

    def test_41_inline_service_date_removed_without_neighbor_damage(self):
        source = "Врач: Иванов Иван Иванович    дата: 01.02.2026"
        result, blob = self.run_parts(minimal(source))
        output = self.text(blob)
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(output, "Врач: [УДАЛЕНО]")
        self.assertFalse(service_date_spans(output))

    def test_42_exam_date_split_across_text_runs(self):
        parts = minimal("")
        root = parse(parts["word/document.xml"])
        p = root.find(".//w:p", NS)
        p.clear()
        for fragment in ["Дата исследования: ", "01.02.", "2026", " Заключение: без отрицательной динамики."]:
            ET.SubElement(ET.SubElement(p, Q("r")), Q("t")).text = fragment
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        output = self.text(blob)
        self.assertEqual(result.status, "PASS", result)
        self.assertNotIn("01.02", output)
        self.assertNotIn("Дата исследования", output)
        self.assertIn("Заключение: без отрицательной динамики.", output)

    def test_43_medical_measurements_and_clinical_date_preserved_review(self):
        text = "0,65 × 0,40 см; L4/5, L5/S1, C5/6; 73,85°; D>S; DWI. По сравнению с МРТ от 01.10.2025. После операции от 15.03.2024. В динамике с 10.09.2023."
        result, blob = self.run_parts(minimal(text))
        output = self.text(blob)
        self.assertEqual(result.status, "REVIEW", result)
        for value in ["0,65 × 0,40 см", "L4/5", "L5/S1", "C5/6", "73,85°", "D>S", "DWI", "01.10.2025", "15.03.2024", "10.09.2023"]:
            self.assertIn(value, output)
        self.assertIn("CLINICAL_DATE_REVIEW", result.categories)

    def test_44_birth_and_service_dates_both_removed(self):
        parts = minimal("Описание: без особенностей.")
        root = parse(parts["word/document.xml"])
        body = root.find(Q("body"))
        for text in ["Дата рождения: 01.01.1980", "Дата исследования: 16.11.2026"]:
            p = ET.Element(Q("p"))
            ET.SubElement(ET.SubElement(p, Q("r")), Q("t")).text = text
            body.insert(-1, p)
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        output = self.text(blob)
        self.assertEqual(result.status, "PASS", result)
        self.assertNotIn("01.01.1980", output)
        self.assertNotIn("16.11.2026", output)
        self.assertIn("Дата рождения: [УДАЛЕНО]", output)
        self.assertIn("Описание: без особенностей.", output)
        self.assertFalse(service_date_spans(output))

    def test_45_service_date_in_footer_and_table(self):
        path = rich_fixture(self.source / "footer-date.docx")
        document = Document(path)
        document.sections[0].footer.paragraphs[0].add_run(" Дата проведения: 12.01.2025")
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "Дата исследования:"
        table.cell(0, 1).text = "13.01.2025"
        document.save(path)
        result, blob = process(path, "CASE-000001")
        self.assertEqual(result.status, "PASS", result)
        output = self.text(blob)
        self.assertNotIn("12.01.2025", output)
        self.assertNotIn("13.01.2025", output)
        opened = Document(BytesIO(blob))
        self.assertIn("Заключение без динамики.", opened.sections[0].footer.paragraphs[0].text)

    def test_46_study_type_preserved_through_independent_verifier(self):
        line = "Область и вид исследования: КТ органов брюшной полости"
        result, blob = self.run_parts(minimal(line))
        self.assertEqual(result.status, "PASS", result)
        parts = unpack(blob)
        self.assertFalse(verify(parts, [line]))
        with self.assertRaises(Blocked) as caught:
            verify(parts, [line + " изменено"])
        self.assertEqual(str(caught.exception), "VERIFY_STUDY_TYPE_CHANGED")

    def test_49_study_type_table_row_preserved_exactly(self):
        parts = minimal("Очаг 5 мм.")
        root = parse(parts["word/document.xml"])
        body = root.find(Q("body"))
        table = ET.SubElement(body, Q("tbl"))
        grid = ET.SubElement(table, Q("tblGrid"))
        ET.SubElement(grid, Q("gridCol"), {Q("w"): "2400"})
        ET.SubElement(grid, Q("gridCol"), {Q("w"): "4800"})
        row = ET.SubElement(table, Q("tr"))
        for value in ["Область и вид исследования:", "МРТ пояснично-крестцового отдела позвоночника"]:
            cell = ET.SubElement(row, Q("tc"))
            ET.SubElement(ET.SubElement(ET.SubElement(cell, Q("p")), Q("r")), Q("t")).text = value
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        self.assertEqual(result.status, "PASS", result)
        output = Document(BytesIO(blob))
        self.assertEqual(output.tables[0].cell(0, 0).text, "Область и вид исследования:")
        self.assertEqual(output.tables[0].cell(0, 1).text, "МРТ пояснично-крестцового отдела позвоночника")

    def test_47_thousands_of_paragraphs_and_tables(self):
        document = Document()
        for number in range(1800):
            document.add_paragraph(f"На уровне L{number % 5 + 1}/S1 размеры 0,65 × 0,40 см, угол 73,85°.")
        table = document.add_table(rows=120, cols=3)
        for row in range(120):
            for col in range(3):
                table.cell(row, col).text = f"Ячейка {row}-{col}; T1/STIR"
        path = self.source / "large-synthetic.docx"
        document.save(path)
        result, blob = process(path, "CASE-000001")
        self.assertEqual(result.status, "PASS", result)
        output = Document(BytesIO(blob))
        self.assertEqual(len(output.paragraphs), 1800)
        self.assertEqual(len(output.tables[0].rows), 120)
        self.assertEqual(output.paragraphs[-1].text, "На уровне L5/S1 размеры 0,65 × 0,40 см, угол 73,85°.")

    def test_48_mixed_batch_success_review_and_failure_isolation(self):
        write(self.source / "synthetic-good.docx", minimal("Дата исследования: 01.02.2026\nОбласть и вид исследования: МРТ правого коленного сустава"))
        write(self.source / "synthetic-review.docx", minimal("По сравнению с МРТ от 01.10.2025"))
        (self.source / "synthetic-bad.docx").write_bytes(b"bad synthetic zip")
        counts = run_batch(self.source, self.output)
        self.assertEqual((counts["PASS"], counts["REVIEW"], counts["BLOCKED"]), (1, 1, 1))
        self.assertEqual(len(list((self.output / "Anonymized").glob("*.docx"))), 1)
        self.assertEqual(len(list((self.output / "Review").glob("*.docx"))), 1)
        records = json.loads((self.output / "Reports" / "summary.json").read_text())
        self.assertEqual(len(records), 3)
        self.assertNotIn("synthetic-good", json.dumps(records))


if __name__ == "__main__":
    unittest.main()

