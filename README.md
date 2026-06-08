# Автоматизация выгрузки Excel с сайта

Проект содержит настраиваемую Python-программу для автоматизации браузера: открыть сайт, заполнить поля, выполнить клики в заданной очередности и сохранить Excel-файл, который отдает сайт.

## Что уже собрано

- Последовательность действий задается в YAML/JSON-конфиге, а значит код не нужно менять при перестановке кликов или полей.
- Поддерживаются шаги: `goto`, `fill`, `click`, `select`, `press`, `wait_for_selector`, `wait_for_timeout`, `download_click`, `screenshot`.
- Данные логина/пароля и URL можно передавать через переменные окружения, чтобы не хранить секреты в репозитории.
- Excel-файл сохраняется в папку `downloads`, в папку из параметра `download_dir` или в папку, указанную при запуске через `--download-dir`.
- Можно отложить автозапуск сценария через `--delay` или запустить его в ближайшее указанное время через `--start-at`.

## Установка

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m playwright install chromium
```

## Настройка очередности кликов и заполнения полей

1. Скопируйте пример конфига:

   ```bash
   cp automation_config.example.yaml automation_config.yaml
   ```

2. Откройте `automation_config.yaml` и замените:
   - `url` на адрес нужного сайта;
   - `selector` на CSS-селекторы реальных кнопок/полей;
   - `value` на значения фильтров отчета;
   - `save_as` на желаемое имя Excel-файла.

3. Порядок элементов в блоке `steps` — это порядок действий программы. Чтобы поменять очередность нажатий, просто переставьте шаги местами.

Пример шага для заполнения поля:

```yaml
- action: fill
  selector: "input[name='date_from']"
  value: "2026-06-01"
```

Пример шага для клика:

```yaml
- action: click
  selector: "button[data-testid='apply-filters']"
```

Пример шага для скачивания Excel:

```yaml
- action: download_click
  selector: "button[data-testid='export-excel']"
  save_as: "report_{timestamp}.xlsx"
```

## Запуск

```bash
EXPORT_SITE_URL="https://your-site.example/login" \
EXPORT_SITE_USER="your-login" \
EXPORT_SITE_PASSWORD="your-password" \
python -m excel_export_automation --config automation_config.yaml --verbose
```

Для визуальной отладки можно запустить браузер не в скрытом режиме:

```bash
python -m excel_export_automation --config automation_config.yaml --headless false --verbose
```

## Автозапуск с задержкой и выбор папки сохранения

Чтобы программа стартовала автоматически после задержки, добавьте параметр `--delay`. Поддерживаются секунды, минуты, часы и дни: `30s`, `10m`, `2h`, `1d`. Если указать просто число, оно считается секундами.

```bash
python -m excel_export_automation --config automation_config.yaml --delay 10m --verbose
```

Чтобы запустить сценарий в ближайшее указанное время, используйте `--start-at` в формате `HH:MM`. Например, команда ниже начнет выгрузку в ближайшие 09:30; если сегодня 09:30 уже прошло, запуск будет завтра в 09:30.

```bash
python -m excel_export_automation --config automation_config.yaml --start-at 09:30 --verbose
```

Чтобы сохранить Excel в нужную папку без изменения конфига, используйте `--download-dir`:

```bash
python -m excel_export_automation --config automation_config.yaml --download-dir "D:/Reports/Excel" --verbose
```

Параметры можно объединять, например запустить через 15 минут и сохранить файл в выбранную папку:

```bash
python -m excel_export_automation --config automation_config.yaml --delay 15m --download-dir "D:/Reports/Excel" --verbose
```

## Как подобрать селекторы

1. Откройте сайт в Chrome/Chromium.
2. Нажмите правой кнопкой на нужное поле или кнопку → **Inspect / Просмотреть код**.
3. Выберите стабильный CSS-селектор, например:
   - `input[name='username']`
   - `button[type='submit']`
   - `button[data-testid='export-excel']`
   - `#report-filter`
4. Вставьте селектор в соответствующий шаг `selector`.

Если на сайте есть капча, SMS-код или одноразовый код, такой шаг обычно нельзя полностью автоматизировать без отдельного согласованного механизма авторизации. В этом случае можно запускать `--headless false`, вручную пройти проверку и продолжить сценарий после добавленного ожидания.

## Формат конфига

Основные параметры:

| Поле | Описание |
| --- | --- |
| `headless` | `true` — запуск без окна браузера, `false` — показать окно для отладки. |
| `slow_mo_ms` | Пауза между действиями Playwright в миллисекундах. Удобно для отладки. |
| `timeout_ms` | Максимальное ожидание элемента/скачивания. |
| `download_dir` | Папка для скачанных Excel-файлов. Можно переопределить при запуске через `--download-dir`. |
| `default_excel_name` | Имя файла по умолчанию. Поддерживает `{timestamp}`. |
| `steps` | Очередность действий. |

Поддерживаемые действия:

| `action` | Обязательные поля | Назначение |
| --- | --- | --- |
| `goto` | `url` | Открыть страницу. |
| `fill` | `selector`, `value` | Заполнить поле. |
| `click` | `selector` | Нажать кнопку/элемент. |
| `select` | `selector`, `value` | Выбрать значение в `<select>`. |
| `press` | `selector`, `key` | Нажать клавишу в элементе, например `Enter`. |
| `wait_for_selector` | `selector` | Дождаться элемента. |
| `wait_for_timeout` | `milliseconds` | Подождать фиксированное время. |
| `download_click` | `selector` | Нажать элемент и сохранить скачанный файл. |
| `screenshot` | `path` | Сделать скриншот для диагностики. |
