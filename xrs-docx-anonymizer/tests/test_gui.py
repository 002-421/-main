import unittest
from pathlib import Path

from xrs_anonymizer.gui import NETWORK_PATH_MESSAGE, validate_selected_paths


class GuiPathValidationTests(unittest.TestCase):
    def test_unc_source_gets_friendly_message_without_echoing_path(self):
        source = r"\\server\private-share\Документы"
        message = validate_selected_paths(source, str(Path.cwd() / "output"))
        self.assertEqual(message, NETWORK_PATH_MESSAGE)
        self.assertNotIn("server", message)
        self.assertNotIn("private-share", message)

    def test_unc_destination_gets_friendly_message(self):
        message = validate_selected_paths(str(Path.cwd()), r"\\server\results\Архив")
        self.assertEqual(message, "Сетевые папки не поддерживаются. Скопируйте документы в локальную папку.")

    def test_local_paths_are_accepted(self):
        message = validate_selected_paths(str(Path.cwd()), str(Path.cwd() / "результаты"))
        self.assertIsNone(message)


if __name__ == "__main__":
    unittest.main()
