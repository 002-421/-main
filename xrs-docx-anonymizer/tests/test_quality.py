"""Synthetic regressions for dates, device notes, headers and report statistics."""
from collections import Counter
from io import BytesIO
from pathlib import Path
import csv
import json
import tempfile
import unittest
import zipfile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.shared import Inches
from lxml import etree as ET

from xrs_anonymizer.batch import run_batch
from xrs_anonymizer.core import Q, R, NS, process, verify, xml
from xrs_anonymizer.redact import calendar_date_matches
from .fixtures import image, minimal, unpack, write


class QualityRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "input"
        self.source.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def run_parts(self, parts, name="synthetic.docx"):
        return process(write(self.source / name, parts), "CASE-000001")

    def test_all_requested_numeric_and_text_dates_become_neutral_word(self):
        source = (
            "Дата исследования: 01.04.2026; дата: 01/04/2026; "
            "сравнение от 01-04-2026; дата по ISO 2026-04-01; "
            "двузначный год 01.04.26 г.; текстовая дата 15 марта 2026 года."
        )
        result, blob = self.run_parts(minimal(source))
        output = "\n".join("".join(ET.fromstring(part).itertext(Q("t"))) for name, part in unpack(blob).items() if name.startswith("word/") and name.endswith(".xml"))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.replaced_dates, 6)
        self.assertGreaterEqual(output.count("дата"), 6)
        for original in ["01.04.2026", "01/04/2026", "01-04-2026", "2026-04-01", "01.04.26", "15 марта 2026 года"]:
            self.assertNotIn(original, output)
        self.assertFalse(calendar_date_matches(output))

    def test_text_date_split_across_word_runs_is_replaced(self):
        parts = minimal("")
        root = ET.fromstring(parts["word/document.xml"])
        paragraph = root.find(".//w:p", NS)
        paragraph.clear()
        for fragment in ["По сравнению с предыдущим исследованием от ", "15 ма", "рта 2026", " года сохранены измерения."]:
            ET.SubElement(ET.SubElement(paragraph, Q("r")), Q("t")).text = fragment
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.replaced_dates, 1)
        self.assertIn("от дата сохранены измерения", output)
        self.assertNotIn("марта 2026", output)

    def test_spaced_numeric_and_abbreviated_russian_dates_are_replaced(self):
        text = "Отчёт от 15 . 03 . 2026 г.; контроль от 15 мар. 2026 года.; запись от 15\u00a0марта\u00a02026 года."
        result, blob = self.run_parts(minimal(text))
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.replaced_dates, 3)
        self.assertEqual(output, "Отчёт от дата; контроль от дата.; запись от дата.")

    def test_invalid_calendar_candidate_is_neutralized_and_reviewed(self):
        source = "Дата исследования: 31.02.2026. Размеры 0.62-0.91 см, уровень L4/5, последовательности T1/T2."
        result, blob = self.run_parts(minimal(source))
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(result.status, "REVIEW_REQUIRED", result)
        self.assertEqual(result.reason, "AMBIGUOUS_DATE_REVIEW")
        self.assertEqual(result.replaced_dates, 1)
        self.assertNotIn("31.02.2026", output)
        for clinical_value in ["0.62-0.91 см", "L4/5", "T1/T2"]:
            self.assertIn(clinical_value, output)
        self.assertIn("AMBIGUOUS_DATE_REVIEW", result.categories)

    def test_supported_non_date_clinical_numbers_are_not_date_candidates(self):
        text = "0.62-0.91 см; 0.3-0.5 см; L4/5, Th12/L1; T1, T2; ADC 0.85; PI-RADS 3."
        self.assertEqual(calendar_date_matches(text), [])
        result, blob = self.run_parts(minimal(text))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.replaced_dates, 0)
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(output, text)

    def test_year_first_slash_shape_is_reviewed_not_mistaken_for_an_id(self):
        result, blob = self.run_parts(minimal("Результат сопоставлен с исследованием 2026/03/15."))
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(result.status, "REVIEW_REQUIRED", result)
        self.assertEqual(result.reason, "AMBIGUOUS_DATE_REVIEW")
        self.assertNotIn("2026/03/15", output)
        self.assertEqual(result.replaced_dates, 1)

    def test_headers_and_footers_from_all_sections_and_variants_are_removed(self):
        document = Document()
        document.add_paragraph("Область и вид исследования: МРТ позвоночника")
        document.add_paragraph("На уровне L4/5 размеры 0.62-0.91 см.")
        document.settings.odd_and_even_pages_header_footer = True
        first = document.sections[0]
        first.different_first_page_header_footer = True
        header_regions = [first.header, first.first_page_header, first.even_page_header]
        footer_regions = [first.footer, first.first_page_footer, first.even_page_footer]
        for i, region in enumerate(header_regions + footer_regions):
            region.paragraphs[0].text = f"Ф.И.О. пациента: Синтетический Пациент {i}"
        header_regions[0].add_table(rows=1, cols=1, width=Inches(4)).cell(0, 0).text = "Синтетический штамп"
        header_regions[1].paragraphs[0].add_run().add_picture(image("PNG"))
        second = document.add_section(WD_SECTION.NEW_PAGE)
        second.different_first_page_header_footer = True
        for i, region in enumerate([
            second.header, second.first_page_header, second.even_page_header,
            second.footer, second.first_page_footer, second.even_page_footer,
        ], start=10):
            region.is_linked_to_previous = False
            region.paragraphs[0].text = f"Тестовый колонтитул {i}"
        document.add_paragraph("Заключение: клиническое описание сохранено.")
        path = self.source / "multi-section-synthetic.docx"
        document.save(path)
        with zipfile.ZipFile(path) as archive:
            input_parts = archive.namelist()
        expected_parts = [name for name in input_parts if name.startswith("word/header") or name.startswith("word/footer")]

        result, blob = process(path, "CASE-000001")
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual(result.removed_headers, len(expected_parts))
        parts = unpack(blob)
        self.assertFalse(any(name.startswith(("word/header", "word/footer", "word/media/")) for name in parts))
        self.assertNotIn(b"headerReference", b"".join(parts.values()))
        self.assertNotIn(b"footerReference", b"".join(parts.values()))
        self.assertNotIn(b"/header", parts["word/_rels/document.xml.rels"])
        self.assertNotIn(b"/footer", parts["word/_rels/document.xml.rels"])
        self.assertFalse(verify(parts))
        output = Document(BytesIO(blob))
        self.assertEqual(len(output.sections), 2)
        self.assertEqual(output.sections[0].header.paragraphs[0].text, "")
        self.assertEqual(output.sections[1].footer.paragraphs[0].text, "")

    def test_scanner_service_paragraph_is_removed_without_dropping_clinical_comparison(self):
        parts = minimal("Описание: очаг 8 мм.")
        root = ET.fromstring(parts["word/document.xml"])
        body = root.find(Q("body"))
        service = ET.Element(Q("p"))
        ET.SubElement(ET.SubElement(service, Q("r")), Q("t")).text = (
            "Исследование выполнено на магнитно-резонансном томографе Philips Achieva 1.5 Тл."
        )
        body.insert(-1, service)
        clinical = ET.Element(Q("p"))
        ET.SubElement(ET.SubElement(clinical, Q("r")), Q("t")).text = (
            "При сравнении исследований на томографе Philips Achieva очаг 8 мм без динамики."
        )
        body.insert(-1, clinical)
        parts["word/document.xml"] = xml(root)
        result, blob = self.run_parts(parts)
        output = "".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t")))
        self.assertEqual(result.status, "PASS", result)
        self.assertIn("SCANNER_SERVICE_DETAILS_REMOVED", result.categories)
        self.assertNotIn("Исследование выполнено на магнитно-резонансном томографе", output)
        self.assertIn("При сравнении исследований на томографе Philips Achieva очаг 8 мм без динамики.", output)

    def test_anatomy_and_known_medical_terms_do_not_create_name_review(self):
        text = "Медиальный мениск; передняя крестообразная связка; коленный сустав; грыжа Шморля; Modic II; PI-RADS 3."
        result, blob = self.run_parts(minimal(text))
        self.assertEqual(result.status, "PASS", result)
        self.assertEqual("".join(ET.fromstring(unpack(blob)["word/document.xml"]).itertext(Q("t"))), text)

    def test_five_synthetic_protocol_shapes_keep_clinical_text_and_remove_identifiers(self):
        protocols = [
            ("brain-mri.docx", [
                "Ф.И.О. пациента: Иванов Иван Иванович",
                "Дата рождения: 16.10.1973",
                "Область и вид исследования: МРТ головного мозга",
                "Срединные структуры не смещены. Очаг 0.62-0.91 см.",
            ]),
            ("abdomen-ct.docx", [
                "Пациент: Петров Пётр Петрович",
                "Дата исследования: 17/11/2026",
                "Размер печени 14.2 см. Заключение без очаговых изменений.",
            ]),
            ("spine-mri.docx", [
                "Врач: Сидоров Сидор Сидорович",
                "Исследование выполнено на аппарате Siemens Magnetom Avanto.",
                "На уровне L4/5 протрузия 3.4 мм; Modic II.",
                "Сравнение от 2026-11-17.",
            ]),
            ("knee-mri.docx", [
                "Ф.И.О. пациента: Тестовый Пациент Синтетический",
                "Дата проведения: 18-11-2026",
                "Передняя крестообразная связка прослеживается. BI-RADS 2.",
            ]),
            ("chest-ct.docx", [
                "Исследование выполнено на компьютерном томографе Canon Aquilion.",
                "Дата исследования: 15 марта 2026 года",
                "Лёгочная ткань без инфильтрации. Размер очага 4 мм.",
            ]),
        ]
        for filename, paragraphs in protocols:
            with self.subTest(protocol=filename):
                document = Document()
                for text in paragraphs:
                    document.add_paragraph(text)
                document.sections[0].header.paragraphs[0].text = "Ф.И.О. пациента: Скрытая Персона Тестовна"
                path = self.source / filename
                document.save(path)
                result, blob = process(path, "CASE-000001")
                self.assertEqual(result.status, "PASS", result)
                output_parts = unpack(blob)
                contents = "\n".join(
                    "".join(ET.fromstring(data).itertext(Q("t")))
                    for name, data in output_parts.items()
                    if name.startswith("word/") and name.endswith(".xml") and not name.endswith(".rels")
                )
                for identifying in ["Иванов", "Петров", "Сидоров", "Скрытая", "1973", "2026"]:
                    self.assertNotIn(identifying, contents)
                self.assertFalse(any(name.startswith(("word/header", "word/footer")) for name in output_parts))
                self.assertGreaterEqual(len(Document(BytesIO(blob)).paragraphs), 1)

    def test_reports_include_metrics_reason_codes_and_aggregates_without_source_names(self):
        good = Document()
        good.add_paragraph("Ф.И.О. пациента: Иванов Иван Иванович")
        good.add_paragraph("Дата исследования: 01.04.2026")
        good_path = self.source / "SECRET_source_name.docx"
        good.save(good_path)
        review = self.source / "review-synthetic.docx"
        write(review, minimal("Дата исследования: 31.02.2026"))
        bad = self.source / "failed-synthetic.docx"
        bad.write_bytes(b"not a docx")

        output = self.root / "output"
        run_batch(self.source, output)
        summary = json.loads((output / "Reports" / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["aggregate"]["PASS"], 1)
        self.assertEqual(summary["aggregate"]["REVIEW_REQUIRED"], 1)
        self.assertEqual(summary["aggregate"]["FAILED"], 1)
        self.assertEqual(summary["aggregate"]["common_review_reasons"], [{"code": "AMBIGUOUS_DATE_REVIEW", "count": 1}])
        case = next(item for item in summary["records"] if item["status"] == "PASS")
        self.assertEqual(case["replaced_dates"], 1)
        self.assertIn("removed_images", case)
        self.assertIn("removed_headers", case)
        self.assertNotIn("SECRET_source_name", json.dumps(summary))

        with (output / "Reports" / "summary.csv").open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(rows[0]["record_type"], "CASE")
        self.assertIn("replaced_dates", rows[0])
        self.assertIn("removed_images", rows[0])
        self.assertIn("removed_headers", rows[0])
        aggregate = Counter(row["status"] for row in rows if row["record_type"] == "AGGREGATE")
        self.assertEqual(aggregate["PASS"], 1)
        self.assertEqual(aggregate["REVIEW_REQUIRED"], 1)
        self.assertEqual(aggregate["FAILED"], 1)
        self.assertNotIn("SECRET_source_name", json.dumps(rows))


if __name__ == "__main__":
    unittest.main()
