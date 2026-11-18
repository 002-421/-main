"""Russian Tkinter UI. Worker never touches widgets; paths are not logged."""
import queue
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from .batch import BatchError, require_local, run_batch


NETWORK_PATH_MESSAGE = (
    "Сетевые папки не поддерживаются. "
    "Скопируйте документы в локальную папку."
)


def validate_selected_paths(source_text: str, destination_text: str) -> str | None:
    """Return a safe, user-facing error without echoing a selected path."""
    try:
        require_local(Path(source_text))
        require_local(Path(destination_text))
    except BatchError:
        return NETWORK_PATH_MESSAGE
    return None


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
    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)

    # The document controls scroll independently; the operational status and
    # buttons stay in the separate, non-scrolling bottom dock.
    body = ttk.Frame(root)
    body.grid(row=0, column=0, sticky="nsew")
    body.columnconfigure(0, weight=1)
    body.rowconfigure(0, weight=1)
    canvas = tk.Canvas(body, highlightthickness=0, borderwidth=0)
    canvas.grid(row=0, column=0, sticky="nsew")
    scrollbar = ttk.Scrollbar(body, orient="vertical", command=canvas.yview)
    scrollbar.grid(row=0, column=1, sticky="ns")
    canvas.configure(yscrollcommand=scrollbar.set)
    content = ttk.Frame(canvas, padding=(22, 18, 22, 18))
    content_window = canvas.create_window((0, 0), window=content, anchor="nw")
    content.columnconfigure(0, weight=1)

    def update_scroll_region(_event=None):
        canvas.configure(scrollregion=canvas.bbox("all"))

    def resize_content(event):
        canvas.itemconfigure(content_window, width=event.width)
        notice.configure(wraplength=max(240, event.width - 44))

    content.bind("<Configure>", update_scroll_region)
    canvas.bind("<Configure>", resize_content)

    screen_width = root.winfo_screenwidth()
    screen_height = root.winfo_screenheight()
    initial_wrap = max(280, min(820, screen_width - 100))

    ttk.Label(content, text="Обезличивание DOCX", font=(family, 19, "bold")).grid(
        row=0, column=0, sticky="w"
    )
    ttk.Label(content, text="Локальная обработка • исходные файлы не изменяются").grid(
        row=1, column=0, sticky="w", pady=(4, 16)
    )

    source, destination = tk.StringVar(), tk.StringVar()
    controls = []
    for row_number, (title, variable) in enumerate(
        [("Папка с DOCX", source), ("Папка для результата", destination)], start=2
    ):
        group = ttk.Frame(content)
        group.grid(row=row_number, column=0, sticky="ew", pady=6)
        group.columnconfigure(0, weight=1)
        ttk.Label(group, text=title).grid(row=0, column=0, sticky="w", pady=(0, 3))
        entry_row = ttk.Frame(group)
        entry_row.grid(row=1, column=0, sticky="ew")
        entry_row.columnconfigure(0, weight=1)
        entry = ttk.Entry(entry_row, textvariable=variable)
        entry.grid(row=0, column=0, sticky="ew")

        def choose(v=variable, path_entry=entry):
            selected = filedialog.askdirectory(parent=root, title="Выберите папку")
            if selected:
                v.set(selected)
                path_entry.icursor("end")

        button = ttk.Button(entry_row, text="Выбрать…", command=choose)
        button.grid(row=0, column=1, padx=(8, 0))
        controls.extend([entry, button])

    recursive = tk.BooleanVar(value=True)
    checkbox = ttk.Checkbutton(content, text="Обрабатывать вложенные папки", variable=recursive)
    checkbox.grid(row=4, column=0, sticky="w", pady=(14, 2))
    controls.append(checkbox)

    mandatory_vars = []
    for index, label in enumerate(
        ["Удалять все изображения", "Удалять персональные данные", "Очищать метаданные", "Проверять результат повторно"],
        start=5,
    ):
        value = tk.BooleanVar(value=True)
        mandatory_vars.append(value)
        ttk.Checkbutton(content, text=label, state="disabled", variable=value).grid(
            row=index, column=0, sticky="w", pady=2
        )
    notice = ttk.Label(
        content,
        text="Защитные проверки обязательны и всегда включены.",
        foreground="#555555",
        wraplength=initial_wrap,
    )
    notice.grid(row=9, column=0, sticky="w", pady=(5, 14))

    dock = ttk.Frame(root, padding=(20, 8, 20, 12))
    dock.grid(row=1, column=0, sticky="ew")
    dock.columnconfigure(0, weight=1)
    ttk.Separator(dock, orient="horizontal").grid(row=0, column=0, sticky="ew", pady=(0, 8))
    status = tk.StringVar(value="Выберите две отдельные папки.")
    status_label = ttk.Label(dock, textvariable=status, wraplength=initial_wrap)
    status_label.grid(row=1, column=0, sticky="ew", pady=(0, 4))
    counts_var = tk.StringVar(value="Всего: 0 • Обработано: 0\nУспешно: 0 • На проверку: 0 • Ошибки: 0")
    counts_label = ttk.Label(dock, textvariable=counts_var, wraplength=initial_wrap)
    counts_label.grid(row=2, column=0, sticky="w", pady=(0, 5))
    progress = ttk.Progressbar(dock, mode="determinate")
    progress.grid(row=3, column=0, sticky="ew", pady=(0, 8))
    review_notice = ttk.Label(
        dock,
        text="PASS означает прохождение автоматических проверок. Перед внешней передачей необходим ручной контроль.",
        wraplength=initial_wrap,
    )
    review_notice.grid(row=4, column=0, sticky="ew", pady=(0, 8))
    buttons = ttk.Frame(dock)
    buttons.grid(row=5, column=0, sticky="w")
    start_button = ttk.Button(buttons, text="Начать обезличивание")
    start_button.pack(side="left")
    stop_button = ttk.Button(buttons, text="Остановить", state="disabled")
    stop_button.pack(side="left", padx=(10, 0))

    def resize_dock(event):
        wraplength = max(260, event.width - 44)
        status_label.configure(wraplength=wraplength)
        counts_label.configure(wraplength=wraplength)
        review_notice.configure(wraplength=wraplength)

    dock.bind("<Configure>", resize_dock)

    def on_mousewheel(event):
        # Bind globally so wheel scrolling also works over controls embedded in
        # the canvas. Ignore events over the pinned dock.
        left = canvas.winfo_rootx()
        top = canvas.winfo_rooty()
        if not (left <= event.x_root < left + canvas.winfo_width() and top <= event.y_root < top + canvas.winfo_height()):
            return None
        delta = getattr(event, "delta", 0) or 0
        if delta:
            units = -int(delta / 120)
            if units == 0:
                units = -1 if delta > 0 else 1
            canvas.yview_scroll(units, "units")
        elif getattr(event, "num", None) == 4:
            canvas.yview_scroll(-1, "units")
        elif getattr(event, "num", None) == 5:
            canvas.yview_scroll(1, "units")
        else:
            return None
        return "break"

    root.bind_all("<MouseWheel>", on_mousewheel)
    root.bind_all("<Button-4>", on_mousewheel)
    root.bind_all("<Button-5>", on_mousewheel)

    messages = queue.Queue()
    cancellation = threading.Event()
    running = False
    close_requested = False

    def worker(src, dst, recurse):
        try:
            stats = run_batch(
                Path(src),
                Path(dst),
                recurse,
                callback=lambda item: messages.put(("progress", item)),
                cancel=cancellation,
            )
            messages.put(("done", stats))
        except BatchError as exc:
            error = str(exc)
            if "сетев" in error.casefold():
                error = NETWORK_PATH_MESSAGE
            messages.put(("error", error))
        except Exception:
            messages.put(("error", "Не удалось завершить обработку. Проверьте доступ к папкам и свободное место. Диагностика не содержит имён документов."))

    def start():
        nonlocal running
        source_text = source.get().strip()
        destination_text = destination.get().strip()
        if not source_text or not destination_text:
            messagebox.showinfo("Папки не выбраны", "Выберите папку источника и отдельную папку результата.", parent=root)
            return
        path_error = validate_selected_paths(source_text, destination_text)
        if path_error:
            messagebox.showwarning("Сетевые папки не поддерживаются", path_error, parent=root)
            return
        running = True
        cancellation.clear()
        for control in controls + [start_button]:
            control.configure(state="disabled")
        stop_button.configure(state="normal")
        status.set("Выполняется локальная обработка…")
        threading.Thread(
            target=worker,
            args=(source_text, destination_text, recursive.get()),
            daemon=True,
        ).start()

    start_button.configure(command=start)

    def stop():
        cancellation.set()
        status.set("Остановка после текущего документа…")
        stop_button.configure(state="disabled")

    stop_button.configure(command=stop)

    def poll():
        nonlocal running
        while not messages.empty():
            kind, value = messages.get_nowait()
            if kind == "progress":
                counts_var.set(
                    f"Всего: {value['total']} • Обработано: {value['processed']}\n"
                    f"Успешно: {value['PASS']} • На проверку: {value['REVIEW_REQUIRED']} • Ошибки: {value['FAILED']}"
                )
                progress.configure(maximum=max(1, value["total"]), value=value["processed"])
            else:
                running = False
                if close_requested:
                    root.destroy()
                    return
                for control in controls + [start_button]:
                    control.configure(state="normal")
                stop_button.configure(state="disabled")
                status.set(
                    "Обработка остановлена. Отчёт сохранён."
                    if kind == "done" and value["cancelled"]
                    else "Готово. Проверьте Reports и изолированную папку Review."
                    if kind == "done"
                    else value
                )
        root.after(100, poll)

    def close():
        nonlocal close_requested
        if running:
            close_requested = True
            cancellation.set()
            stop_button.configure(state="disabled")
            status.set("Идёт остановка. Окно закроется после текущего документа.")
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.after(100, poll)
    root.update_idletasks()

    # Keep the pinned controls above the minimum window height even on displays
    # with a small work area. The document pane can shrink and scroll instead.
    min_width = max(buttons.winfo_reqwidth() + 48, min(560, max(400, screen_width - 80)))
    min_wraplength = max(260, min_width - 44)
    status_label.configure(wraplength=min_wraplength)
    counts_label.configure(wraplength=min_wraplength)
    review_notice.configure(wraplength=min_wraplength)
    root.update_idletasks()
    dock_height = dock.winfo_reqheight()
    min_height = max(dock_height + 40, min(420, max(280, screen_height - 80)))
    root.minsize(min_width, min_height)
    width = min(860, max(min_width, screen_width - 100))
    height = min(740, max(min_height, screen_height - 120))
    root.geometry(f"{width}x{height}")
    root.mainloop()
