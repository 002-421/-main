# Библиотеки и лицензии

Приложение: Python 3.12 (PSF License), Tk/Tcl (BSD-подобные лицензии), lxml 6.1.1 (BSD-3-Clause; wheel включает libxml2/libxslt и их лицензии).

Разработка/тесты: python-docx 1.2.0 (MIT), Pillow 13.0.0 (MIT-CMU). Эти пакеты исключены из PyInstaller-приложения.

Сборка: PyInstaller 6.16.0 (GPL с исключением, допускающим распространение созданных им приложений), pyinstaller-hooks-contrib 2025.9 (GPL с исключением; см. лицензию пакета), altgraph (MIT), packaging (Apache-2.0/BSD), pefile (MIT), pywin32-ctypes (BSD-3-Clause).

Оригинальные тексты лицензий runtime и инструментов сборки собираются в `licenses/` дистрибутива через `tools/collect_licenses.py`. PyInstaller также сохраняет стандартные данные Tcl/Tk. Перед распространением проверьте содержимое licenses и штатные notices включённых binary wheels. В исходном проекте нет коммерческих моделей, словарей или медицинских шаблонов сторонних владельцев.
