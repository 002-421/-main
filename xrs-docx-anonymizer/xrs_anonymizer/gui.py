"""Russian Tkinter UI. Worker never touches widgets; paths are not logged."""
import queue
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from .batch import BatchError, run_batch


def main():
    root = tk.Tk()
    families = set(tkfont.families(root))
    family = next((name for name in ("Segoe UI", "Noto Sans Display", "DejaVu Sans", "Arial") if name in families), "sans")
    for name in tkfont.names(root):
        tkfont.nametofont(name, root=root).configure(family=family, size=10)
    style = ttk.Style(root)
    if "clam" in style.theme_names():
        style.theme_use("clam")
    style.configure(".", font=(family, 10))
    root.title("XRS DOCX Anonymizer — локальная утилита")
    root.geometry("790x600")
    root.minsize(720, 580)
    panel = ttk.Frame(root, padding=24)
    panel.pack(fill="both", expand=True)
    ttk.Label(panel, text="Обезличивание DOCX", font=(family, 19, "bold")).pack(anchor="w")
    ttk.Label(panel, text="Локальная обработка • исходные файлы не изменяются").pack(anchor="w", pady=(4, 18))
    source, destination = tk.StringVar(), tk.StringVar()
    controls = []
    for title, variable in [("Папка с DOCX", source), ("Папка для результата", destination)]:
        row = ttk.Frame(panel)
        row.pack(fill="x", pady=5)
        ttk.Label(row, text=title, width=24).pack(side="left")
        entry = ttk.Entry(row, textvariable=variable)
        entry.pack(side="left", fill="x", expand=True)
        def choose(v=variable):
            selected = filedialog.askdirectory(parent=root, title="Выберите папку")
            if selected:
                v.set(selected)
        button = ttk.Button(row, text="Выбрать…", command=choose)
        button.pack(side="right", padx=(8, 0))
        controls.extend([entry, button])
    recursive = tk.BooleanVar(value=True)
    checkbox = ttk.Checkbutton(panel, text="Обрабатывать вложенные папки", variable=recursive)
    checkbox.pack(anchor="w", pady=(14, 2))
    controls.append(checkbox)
    mandatory_vars = []
    for label in ["Удалять все изображения", "Удалять персональные данные", "Очищать метаданные", "Проверять результат повторно"]:
        value = tk.BooleanVar(value=True)
        mandatory_vars.append(value)
        ttk.Checkbutton(panel, text=label, variable=value, state="disabled").pack(anchor="w", pady=2)
    ttk.Label(panel, text="Защитные проверки обязательны и всегда включены.", foreground="#555555").pack(anchor="w", pady=(5, 14))
    counts_var = tk.StringVar(value="Всего: 0   Обработано: 0   Успешно: 0   На проверку: 0   Ошибки: 0")
    ttk.Label(panel, textvariable=counts_var).pack(anchor="w", pady=(5, 8))
    progress = ttk.Progressbar(panel, mode="determinate")
    progress.pack(fill="x")
    status = tk.StringVar(value="Выберите две отдельные папки.")
    ttk.Label(panel, textvariable=status, wraplength=720).pack(anchor="w", pady=(10, 8))
    ttk.Label(panel, text="PASS означает прохождение автоматических проверок.\nПеред внешней передачей необходим ручной контроль. REVIEW хранится отдельно.", wraplength=720).pack(anchor="w", pady=8)
    messages = queue.Queue()
    cancellation = threading.Event()
    running = False

    def worker(src, dst, recurse):
        try:
            stats = run_batch(Path(src), Path(dst), recurse, callback=lambda item: messages.put(("progress", item)), cancel=cancellation)
            messages.put(("done", stats))
        except BatchError as exc:
            messages.put(("error", str(exc)))
        except Exception:
            messages.put(("error", "Не удалось завершить обработку. Проверьте доступ к папкам и свободное место. Диагностика не содержит имён документов."))

    def start():
        nonlocal running
        if not source.get().strip() or not destination.get().strip():
            messagebox.showinfo("Папки не выбраны", "Выберите папку источника и отдельную папку результата.", parent=root)
            return
        running = True
        cancellation.clear()
        for control in controls + [start_button]:
            control.configure(state="disabled")
        stop_button.configure(state="normal")
        status.set("Выполняется локальная обработка…")
        threading.Thread(target=worker, args=(source.get(), destination.get(), recursive.get()), daemon=True).start()

    def stop():
        cancellation.set()
        status.set("Остановка после текущего документа…")
        stop_button.configure(state="disabled")

    buttons = ttk.Frame(panel)
    buttons.pack(fill="x", pady=(10, 0))
    start_button = ttk.Button(buttons, text="Начать обезличивание", command=start)
    start_button.pack(side="left")
    stop_button = ttk.Button(buttons, text="Остановить", state="disabled", command=stop)
    stop_button.pack(side="left", padx=10)

    def poll():
        nonlocal running
        while not messages.empty():
            kind, value = messages.get_nowait()
            if kind == "progress":
                counts_var.set(f"Всего: {value['total']}   Обработано: {value['processed']}   Успешно: {value['PASS']}   На проверку: {value['REVIEW']}   Ошибки: {value['BLOCKED']}")
                progress.configure(maximum=max(1, value["total"]), value=value["processed"])
            else:
                running = False
                for control in controls + [start_button]:
                    control.configure(state="normal")
                stop_button.configure(state="disabled")
                status.set("Обработка остановлена. Отчёт сохранён." if kind == "done" and value["cancelled"] else "Готово. Проверьте Reports и изолированную папку Review." if kind == "done" else value)
        root.after(100, poll)

    def close():
        if running:
            stop()
            status.set("Дождитесь остановки текущего документа, затем закройте окно.")
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.after(100, poll)
    root.mainloop()
