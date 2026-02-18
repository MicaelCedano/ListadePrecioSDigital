import customtkinter as ctk
from tkinter import ttk, filedialog, messagebox, colorchooser
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from datetime import datetime
import os
import locale
import sys
import sqlite3
import threading
import pandas as pd
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

# --- PYINSTALLER HELPER ---
# This function is crucial for the .exe to find its data files (fonts, etc.)
# It returns the correct path whether running from source or from a bundled app.
def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

# --- INITIAL CONFIGURATION ---
try:
    locale.setlocale(locale.LC_ALL, 'es_DO')
except locale.Error:
    try:
        locale.setlocale(locale.LC_ALL, 'es_ES')
    except locale.Error:
        # Fallback to system's default locale
        locale.setlocale(locale.LC_ALL, '')

# Configuration and database files
CONFIG_FILE = "config.json"
DB_FILE = "sena_digital.db" # This will be located next to the .exe

# Old JSON files for migration (kept for legacy support)
OLD_BRANDS_FILE = "brands.json"
OLD_INVENTORY_FILE = "inventory.json"

DEFAULT_BRANDS = {
    "SAMSUNG": "#0057B7", "INFINIX": "#2E8B57", "ZTE": "#00BFFF",
    "ITEL": "#FF6347", "BLU": "#4169E1", "UMIDIGI": "#8A2BE2",
    "MOTOROLA": "#4682B4", "TABLETAS": "#FF8C00", "TELEVISORES": "#DC143C",
    "CUBOT": "#6A5ACD", "TECNO": "#20B2AA", "ROVER": "#DAA520",
    "VORTEX": "#556B2F", "M-HORSE": "#8B4513", "RELOJ": "#DB7093",
    "TCL": "#E60012", "AIRES ACON.": "#87CEEB", "OUKITEL": "#1E90FF",
    "GENERICO": "#778899", "OTROS": "#A9A9A9",
}

# UI scaling factor to increase font sizes and widget scale for high-DPI or small-default displays
UI_SCALE = 1.5  # increase this value to make UI elements larger

def ui_scale(value):
    """Scale numeric UI sizes by the global UI_SCALE."""
    try:
        return int(value * UI_SCALE)
    except Exception:
        return value

# --- DATABASE MANAGER CLASS ---
class DatabaseManager:
    def __init__(self, db_file):
        # Use plain path to ensure the DB is found/created next to the .exe (persistent), not in temp bundle
        self.conn = sqlite3.connect(db_file)
        self.create_tables()

    def _execute(self, query, params=(), fetch=None):
        with self.conn:
            cursor = self.conn.cursor()
            cursor.execute(query, params)
            if fetch == 'one': return cursor.fetchone()
            if fetch == 'all': return cursor.fetchall()

    def create_tables(self):
        self._execute('CREATE TABLE IF NOT EXISTS brands (name TEXT PRIMARY KEY, color TEXT NOT NULL, order_index INTEGER)')
        self._execute('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, specs TEXT, price_float REAL NOT NULL, price_str TEXT NOT NULL)')
        try: self._execute("SELECT order_index FROM brands LIMIT 1")
        except sqlite3.OperationalError:
            self._execute("ALTER TABLE brands ADD COLUMN order_index INTEGER")
            brands = self._execute("SELECT name FROM brands", fetch='all')
            for i, (brand_name,) in enumerate(brands):
                self._execute("UPDATE brands SET order_index = ? WHERE name = ?", (i, brand_name))

    def migrate_from_json_if_needed(self):
        if os.path.exists(OLD_BRANDS_FILE):
            try:
                with open(OLD_BRANDS_FILE, 'r') as f: brands_data = json.load(f)
                if isinstance(brands_data, dict):
                    for i, (name, color) in enumerate(brands_data.items()):
                        self._execute("INSERT OR IGNORE INTO brands (name, color, order_index) VALUES (?, ?, ?)", (name, color, i))
                os.rename(OLD_BRANDS_FILE, OLD_BRANDS_FILE + ".migrated")
            except Exception as e: print(f"Could not migrate brands: {e}")
        
        if os.path.exists(OLD_INVENTORY_FILE):
            try:
                with open(OLD_INVENTORY_FILE, 'r') as f: inventory_data = json.load(f)
                if isinstance(inventory_data, list):
                    for item in inventory_data: self.add_or_update_inventory(item, ignore_conflict=True)
                os.rename(OLD_INVENTORY_FILE, OLD_INVENTORY_FILE + ".migrated")
            except Exception as e: print(f"Could not migrate inventory: {e}")

    def get_brands(self):
        rows = self._execute("SELECT name, color FROM brands ORDER BY order_index", fetch='all')
        if not rows:
            for i, (name, color) in enumerate(DEFAULT_BRANDS.items()):
                self.add_brand(name, color, i, ignore_conflict=True)
            return DEFAULT_BRANDS.copy()
        return {name: color for name, color in rows}

    def add_brand(self, name, color, order_index, ignore_conflict=False):
        query = "INSERT OR IGNORE INTO brands (name, color, order_index) VALUES (?, ?, ?)" if ignore_conflict else "INSERT INTO brands (name, color, order_index) VALUES (?, ?, ?)"
        self._execute(query, (name, color, order_index))
    
    def update_brand_order(self, ordered_brands):
        with self.conn:
            cursor = self.conn.cursor()
            for i, brand_name in enumerate(ordered_brands):
                cursor.execute("UPDATE brands SET order_index = ? WHERE name = ?", (i, brand_name))

    def get_max_brand_order(self):
        result = self._execute("SELECT MAX(order_index) FROM brands", fetch='one')
        return result[0] if result and result[0] is not None else -1

    def delete_brand(self, name): self._execute("DELETE FROM brands WHERE name = ?", (name,))
    def get_inventory(self):
        rows = self._execute("SELECT id, brand, model, specs, price_float, price_str FROM inventory", fetch='all')
        return [] if not rows else [{"id": r[0], "brand": r[1], "model": r[2], "specs": r[3], "price_float": r[4], "price_str": r[5]} for r in rows]
    def add_or_update_inventory(self, product, ignore_conflict=False):
        query = "INSERT OR REPLACE INTO inventory (id, brand, model, specs, price_float, price_str) VALUES (?, ?, ?, ?, ?, ?)"
        if ignore_conflict: query = "INSERT OR IGNORE INTO inventory (id, brand, model, specs, price_float, price_str) VALUES (?, ?, ?, ?, ?, ?)"
        params = (product['id'], product['brand'], product['model'], product['specs'], product['price_float'], product['price_str'])
        self._execute(query, params)
    def delete_inventory_item(self, product_id): self._execute("DELETE FROM inventory WHERE id = ?", (product_id,))

# --- SECONDARY WINDOWS CLASSES ---
class BrandManager(ctk.CTkToplevel):
    def __init__(self, master):
        super().__init__(master)
        self.master_app = master; self.title("Gestionar y Ordenar Marcas"); self.geometry("600x600"); self.transient(master); self.grab_set()
        self.grid_columnconfigure(0, weight=1); self.grid_rowconfigure(0, weight=1)
        self.brands_list_frame = ctk.CTkScrollableFrame(self, label_text="Arrastra para ordenar (usa los botones)"); self.brands_list_frame.grid(row=0, column=0, padx=15, pady=15, sticky="nsew")
        self.populate_brands_list()
        add_frame = ctk.CTkFrame(self); add_frame.grid(row=1, column=0, padx=15, pady=15, sticky="ew"); add_frame.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(add_frame, text="Nueva Marca:").grid(row=0, column=0, padx=10, pady=10)
        self.new_brand_entry = ctk.CTkEntry(add_frame, placeholder_text="Nombre de la marca"); self.new_brand_entry.grid(row=0, column=1, padx=10, pady=10, sticky="ew")
        self.color_var = ctk.StringVar(value="#FFFFFF")
        self.color_button = ctk.CTkButton(add_frame, text="Elegir Color", command=self.pick_color); self.color_button.grid(row=0, column=2, padx=10, pady=10)
        self.color_preview = ctk.CTkFrame(add_frame, fg_color=self.color_var.get(), width=30, height=30, border_width=1); self.color_preview.grid(row=0, column=3, padx=10, pady=10)
        save_button = ctk.CTkButton(add_frame, text="Guardar Marca", command=self.save_new_brand); save_button.grid(row=1, column=1, columnspan=3, pady=10, sticky="e")
    def populate_brands_list(self):
        for widget in self.brands_list_frame.winfo_children(): widget.destroy()
        self.brand_widgets = []
        self.ordered_brands = list(self.master_app.BRAND_COLORS.keys())
        for i, brand_name in enumerate(self.ordered_brands):
            color = self.master_app.BRAND_COLORS[brand_name]
            row_frame = ctk.CTkFrame(self.brands_list_frame); row_frame.pack(fill="x", pady=4, padx=4); row_frame.grid_columnconfigure(1, weight=1)
            ctk.CTkFrame(row_frame, width=20, height=20, fg_color=color, border_width=1).grid(row=0, column=0, padx=10, pady=5)
            ctk.CTkLabel(row_frame, text=brand_name, font=ctk.CTkFont(size=ui_scale(14))).grid(row=0, column=1, padx=ui_scale(10), sticky="w")
            up_button = ctk.CTkButton(row_frame, text="▲", width=30, command=lambda index=i: self.move_brand(index, -1)); up_button.grid(row=0, column=2, padx=(5,0), pady=5)
            if i == 0: up_button.configure(state="disabled")
            down_button = ctk.CTkButton(row_frame, text="▼", width=30, command=lambda index=i: self.move_brand(index, 1)); down_button.grid(row=0, column=3, padx=(5,0), pady=5)
            if i == len(self.ordered_brands) - 1: down_button.configure(state="disabled")
            delete_button = ctk.CTkButton(row_frame, text="X", width=30, fg_color="#D32F2F", hover_color="#B71C1C", command=lambda b=brand_name: self.delete_brand(b)); delete_button.grid(row=0, column=4, padx=5, pady=5)
            self.brand_widgets.append(row_frame)
    def move_brand(self, index, direction):
        if 0 <= index + direction < len(self.ordered_brands):
            self.ordered_brands.insert(index + direction, self.ordered_brands.pop(index))
            self.master_app.db.update_brand_order(self.ordered_brands); self.master_app.refresh_brand_ui(); self.populate_brands_list()
    def pick_color(self):
        color_code = colorchooser.askcolor(title="Elige un color para la marca")
        if color_code and color_code[1]: self.color_var.set(color_code[1]); self.color_preview.configure(fg_color=color_code[1])
    def save_new_brand(self):
        new_brand_name = self.new_brand_entry.get().strip().upper()
        if not new_brand_name: messagebox.showerror("Error", "El nombre de la marca no puede estar vacío.", parent=self); return
        if new_brand_name in self.master_app.BRAND_COLORS: messagebox.showwarning("Marca Existente", "Esta marca ya existe.", parent=self); return
        max_order = self.master_app.db.get_max_brand_order()
        self.master_app.db.add_brand(new_brand_name, self.color_var.get(), max_order + 1)
        self.master_app.refresh_brand_ui(); self.populate_brands_list(); self.new_brand_entry.delete(0, 'end')
    def delete_brand(self, brand_to_delete):
        if messagebox.askyesno("Confirmar", f"¿Seguro que quieres eliminar la marca '{brand_to_delete}'?", parent=self):
            if brand_to_delete in self.master_app.BRAND_COLORS: self.master_app.db.delete_brand(brand_to_delete); self.master_app.refresh_brand_ui(); self.populate_brands_list()

class InventoryManager(ctk.CTkToplevel):
    def __init__(self, master):
        super().__init__(master)
        self.master_app = master
        self.title("Inventario de Equipos")
        self.geometry("1000x700")  # Aumentado para mejor visualización
        self.transient(master)
        self.grab_set()

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # Frame de Búsqueda
        search_frame = ctk.CTkFrame(self)
        search_frame.grid(row=0, column=0, padx=15, pady=10, sticky="ew")
        search_frame.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(search_frame, text="Buscar:").grid(row=0, column=0, padx=10)
        self.search_var = ctk.StringVar()
        try:
            self.search_var.trace_add("write", self.filter_list)
        except AttributeError:
            try:
                self.search_var.trace("w", self.filter_list)
            except Exception:
                pass # Fallback safe

        self.search_entry = ctk.CTkEntry(search_frame, textvariable=self.search_var, placeholder_text="Filtrar por marca, modelo...")
        self.search_entry.grid(row=0, column=1, padx=10, sticky="ew")

        # Frame de Tabla (Sustituye al ScrollableFrame para rendimiento)
        table_frame = ctk.CTkFrame(self)
        table_frame.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="nsew")
        table_frame.grid_rowconfigure(0, weight=1)
        table_frame.grid_columnconfigure(0, weight=1)

        # Treeview Configuration
        # Reutilizamos los estilos definidos en la app principal si es posible
        self.tree = ttk.Treeview(table_frame, columns=("Marca", "Modelo", "Specs", "Precio"), show="headings")
        self.tree.heading("Marca", text="Marca")
        self.tree.heading("Modelo", text="Modelo")
        self.tree.heading("Specs", text="Especificaciones")
        self.tree.heading("Precio", text="Precio")

        self.tree.column("Marca", width=150, anchor="w")
        self.tree.column("Modelo", width=250, anchor="w")
        self.tree.column("Specs", width=250, anchor="w")
        self.tree.column("Precio", width=120, anchor="e")

        self.tree.grid(row=0, column=0, sticky="nsew")

        # Scrollbar
        scrollbar = ctk.CTkScrollbar(table_frame, command=self.tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        # Binding de doble clic para editar o añadir
        self.tree.bind("<Double-1>", lambda event: self.add_current_selection())

        # Botones de Acción
        actions_frame = ctk.CTkFrame(self)
        actions_frame.grid(row=2, column=0, padx=15, pady=(0, 15), sticky="ew")

        self.add_btn = ctk.CTkButton(actions_frame, text="Añadir a Lista", command=self.add_current_selection)
        self.add_btn.pack(side="left", padx=10, pady=10, expand=True)

        self.edit_btn = ctk.CTkButton(actions_frame, text="Editar", fg_color="#E8A900", hover_color="#B8860B", command=self.edit_current_selection)
        self.edit_btn.pack(side="left", padx=10, pady=10, expand=True)

        self.delete_btn = ctk.CTkButton(actions_frame, text="Eliminar", fg_color="#D32F2F", hover_color="#B71C1C", command=self.delete_current_selection)
        self.delete_btn.pack(side="left", padx=10, pady=10, expand=True)

        self.populate_inventory_list()

    def populate_inventory_list(self, filter_text=""):
        # Limpiar tabla
        for item in self.tree.get_children():
            self.tree.delete(item)

        # Filtrar datos
        filter_text = filter_text.lower()
        filtered_inventory = []
        for p in self.master_app.inventory_data:
            if filter_text == "" or filter_text in (p["brand"] + p["model"] + p["specs"]).lower():
                filtered_inventory.append(p)

        # Insertar en Treeview (Optimizado)
        # Usamos ordenación por Marca luego Modelo
        for product in sorted(filtered_inventory, key=lambda p: (p["brand"], p["model"])):
            values = (product['brand'], product['model'], product['specs'], product['price_str'])
            # Usamos el ID del producto como iid del item para fácil recuperación
            try:
                self.tree.insert("", "end", iid=product['id'], values=values)
            except Exception:
                # Fallback por si hay IDs duplicados corruptos en la DB
                self.tree.insert("", "end", values=values)

    def filter_list(self, *args):
        self.populate_inventory_list(self.search_var.get())

    def get_selected_product(self):
        selected = self.tree.selection()
        if not selected:
            return None
        # Intentamos recuperar por ID (que usamos como iid)
        product_id = selected[0]
        for p in self.master_app.inventory_data:
            if p['id'] == product_id:
                return p
        
        # Fallback: si el iid no coincide (caso duplicado), buscamos por valores?
        # En este diseño, asumimos ID único. Si no, tomamos el primero que coincida.
        return None

    def add_current_selection(self):
        product = self.get_selected_product()
        if not product:
            messagebox.showwarning("Selección", "Por favor selecciona un equipo de la lista.")
            return
        self.add_to_active_list(product)

    def edit_current_selection(self):
        product = self.get_selected_product()
        if not product:
            messagebox.showwarning("Selección", "Por favor selecciona un equipo para editar.")
            return
        self.edit_inventory_item(product)

    def delete_current_selection(self):
        product = self.get_selected_product()
        if not product:
            messagebox.showwarning("Selección", "Por favor selecciona un equipo para eliminar.")
            return
        self.delete_from_inventory(product)

    def add_to_active_list(self, product):
        if any(p['id'] == product['id'] for p in self.master_app.products_data):
            messagebox.showwarning("Duplicado", "Este equipo ya está en la lista activa.", parent=self)
            return
        self.master_app.products_data.append(product.copy())
        self.master_app.update_table(sort_data=False)
        # Feedback sutil (opcional)
        # self.add_btn.configure(text="¡Añadido!", fg_color="green")
        # self.after(1000, lambda: self.add_btn.configure(text="Añadir a Lista", fg_color=["#3a7ebf", "#1f538d"]))

    def edit_inventory_item(self, product_to_edit):
        dialog = ctk.CTkInputDialog(text=f"Editando: {product_to_edit['model']}\nNuevo Precio:", title="Editar Precio de Inventario")
        new_price_str = dialog.get_input()
        if new_price_str:
            try:
                new_price_float = float(new_price_str.replace("RD$", "").replace(",", ""))
                product_to_edit['price_float'] = new_price_float
                product_to_edit['price_str'] = f"RD${locale.format_string('%.2f', new_price_float, grouping=True)}"
                
                # Actualizar también si está en la lista activa
                for active_product in self.master_app.products_data:
                    if active_product['id'] == product_to_edit['id']:
                        active_product['price_float'] = new_price_float
                        active_product['price_str'] = product_to_edit['price_str']
                        break
                
                self.master_app.db.add_or_update_inventory(product_to_edit)
                # Actualizar datos maestros
                self.master_app.inventory_data = self.master_app.db.get_inventory()
                self.master_app.update_table()
                self.populate_inventory_list(self.search_var.get())
            except ValueError:
                messagebox.showerror("Error", "Formato de precio inválido.", parent=self)

    def delete_from_inventory(self, product_to_delete):
        if messagebox.askyesno("Eliminación Permanente", f"¿Seguro que quieres eliminar '{product_to_delete['model']}' del inventario para siempre?", parent=self):
            self.master_app.db.delete_inventory_item(product_to_delete['id'])
            self.master_app.inventory_data = self.master_app.db.get_inventory()
            
            # Tamibén quitar de la lista activa si está presente
            self.master_app.products_data = [p for p in self.master_app.products_data if p['id'] != product_to_delete['id']]
            
            self.master_app.update_table()
            self.populate_inventory_list(self.search_var.get())

# --- MAIN APPLICATION CLASS ---
class PriceListApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Generador de Listas de Precios v2.0 - MEJORADO"); self.geometry(f"{ui_scale(1600)}x{ui_scale(800)}")
        # Apply TK scaling globally to increase default widget sizes where supported
        try:
            self.tk.call('tk', 'scaling', UI_SCALE)
        except Exception:
            pass
        ctk.set_appearance_mode("Dark"); ctk.set_default_color_theme("blue")
        self.products_data = []; self.inventory_data = []; self.logo_path = None; self.current_project_path = "autosave.json"; self.pil_preview_image = None; self.preview_zoom = 1.0
        
        self.db = DatabaseManager(DB_FILE)
        self.db.migrate_from_json_if_needed()

        self.BRAND_COLORS = self.db.get_brands()
        self.inventory_data = self.db.get_inventory()
        self.load_fonts()
        
        self.grid_columnconfigure(1, weight=1); self.grid_columnconfigure(2, weight=0, minsize=600); self.grid_rowconfigure(0, weight=1)
        self.controls_frame = ctk.CTkFrame(self, width=280); self.controls_frame.grid(row=0, column=0, padx=10, pady=10, sticky="ns")
        self.table_frame = ctk.CTkFrame(self); self.table_frame.grid(row=0, column=1, padx=(0, 10), pady=10, sticky="nsew")
        self.preview_frame = ctk.CTkFrame(self); self.preview_frame.grid(row=0, column=2, padx=(0, 10), pady=10, sticky="nsew")
        
        self.create_controls(); self.create_table(); self.create_preview_panel()
        self.load_last_project()

    def refresh_brand_ui(self):
        self.BRAND_COLORS = self.db.get_brands(); new_brand_list = list(self.BRAND_COLORS.keys())
        self.brand_combo.configure(values=new_brand_list)
        if new_brand_list: self.brand_var.set(new_brand_list[0])
        self.update_table()
    
    def open_brand_manager(self): BrandManager(self)
    def open_inventory_manager(self): InventoryManager(self)
    
    def load_fonts(self):
        # MODIFIED: Use resource_path to find fonts, making it .exe compatible
        # Try multiple possible font file names
        possible_fonts = {
            "regular": ["OpenSans-VariableFont_wdth,wght.ttf", "OpenSans-Regular.ttf", "Open Sans-Regular.ttf", "Vera.ttf"],
            "bold": ["OpenSans-VariableFont_wdth,wght.ttf", "OpenSans-Bold.ttf", "Open Sans-Bold.ttf", "VeraBd.ttf"]
        }
        
        self.font_paths = {}
        for font_type, filenames in possible_fonts.items():
            found = False
            for filename in filenames:
                try_path = resource_path(filename)
                if os.path.exists(try_path):
                    # Test if the font file is valid
                    try:
                        ImageFont.truetype(try_path, 10)
                        self.font_paths[font_type] = try_path
                        found = True
                        break
                    except Exception as e:
                        print(f"Could not load font {filename}: {e}")
                        continue
            
        if not self.font_paths or len(self.font_paths) < 2:
            print("Warning: Fonts not found or incomplete. Using default system font.")
            self.font_paths = None
        else:
            print(f"Fonts loaded successfully: {self.font_paths}")

    def create_controls(self):
        ctk.CTkLabel(self.controls_frame, text="Gestión de Equipos", font=ctk.CTkFont(size=ui_scale(18), weight="bold")).pack(pady=ui_scale(10), padx=ui_scale(10))
        form_frame = ctk.CTkFrame(self.controls_frame, fg_color="transparent"); form_frame.pack(pady=10, padx=10, fill="x")
        brand_frame = ctk.CTkFrame(form_frame, fg_color="transparent"); brand_frame.pack(fill='x', pady=(0, 10)); brand_frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(brand_frame, text="Marca:").grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 2))
        self.brand_var = ctk.StringVar(value=list(self.BRAND_COLORS.keys())[0] if self.BRAND_COLORS else "")
        self.brand_combo = ctk.CTkComboBox(brand_frame, values=list(self.BRAND_COLORS.keys()), variable=self.brand_var); self.brand_combo.grid(row=1, column=0, sticky="ew")
        self.brand_manage_btn = ctk.CTkButton(brand_frame, text="...", width=40, command=self.open_brand_manager); self.brand_manage_btn.grid(row=1, column=1, padx=(5,0))
        ctk.CTkLabel(form_frame, text="Modelo:").pack(anchor="w"); self.model_entry = ctk.CTkEntry(form_frame); self.model_entry.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(form_frame, text="Especificaciones:").pack(anchor="w"); self.specs_entry = ctk.CTkEntry(form_frame); self.specs_entry.pack(fill="x", pady=(0, 10))
        ctk.CTkLabel(form_frame, text="Precio:").pack(anchor="w"); self.price_entry = ctk.CTkEntry(form_frame); self.price_entry.pack(fill="x", pady=(0, 10))
        buttons_frame = ctk.CTkFrame(self.controls_frame, fg_color="transparent"); buttons_frame.pack(pady=10, padx=10, fill="x")
        self.add_button = ctk.CTkButton(buttons_frame, text="Agregar Nuevo Equipo", command=self.add_product); self.add_button.pack(pady=5, fill="x")
        self.edit_button = ctk.CTkButton(buttons_frame, text="Editar Seleccionado", command=self.edit_active_item, fg_color="#1F6AA5", hover_color="#144870"); self.edit_button.pack(pady=5, fill="x")
        self.delete_button = ctk.CTkButton(buttons_frame, text="Quitar de la Lista", command=self.remove_from_active_list, fg_color="#E8A900", hover_color="#B8860B"); self.delete_button.pack(pady=5, fill="x")
        ctk.CTkLabel(buttons_frame, text="").pack(pady=5) 
        self.inventory_button = ctk.CTkButton(buttons_frame, text="Gestionar Inventario", command=self.open_inventory_manager, fg_color="#0B666A", hover_color="#073e40"); self.inventory_button.pack(pady=5, fill="x")
        ctk.CTkLabel(buttons_frame, text="").pack(pady=5)
        self.load_logo_button = ctk.CTkButton(buttons_frame, text="Cargar Logo", command=self.select_logo, fg_color="#555555", hover_color="#333333"); self.load_logo_button.pack(pady=5, fill="x")
        self.save_button = ctk.CTkButton(buttons_frame, text="Guardar Lista Como...", command=self.save_project_as, fg_color="#555555", hover_color="#333333"); self.save_button.pack(pady=5, fill="x")
        self.load_button = ctk.CTkButton(buttons_frame, text="Cargar Lista", command=self.load_project_manual, fg_color="#555555", hover_color="#333333"); self.load_button.pack(pady=5, fill="x")
        
        # NEW: Export buttons
        export_frame = ctk.CTkFrame(buttons_frame, fg_color="transparent")
        export_frame.pack(fill="x", pady=5)
        self.export_excel_button = ctk.CTkButton(export_frame, text="📊 Exportar Excel", command=self.export_to_excel, fg_color="#27AE60", hover_color="#229954", width=130)
        self.export_excel_button.pack(side="left", padx=(0, 5))
        self.export_pdf_button = ctk.CTkButton(export_frame, text="📄 Exportar PDF", command=self.export_to_pdf, fg_color="#E74C3C", hover_color="#C0392B", width=130)
        self.export_pdf_button.pack(side="right")
        
        # NEW: Image export options
        image_frame = ctk.CTkFrame(buttons_frame, fg_color="transparent")
        image_frame.pack(fill="x", pady=5)
        self.export_png_button = ctk.CTkButton(image_frame, text="🖼️ Exportar PNG", command=self.export_to_png, fg_color="#9B59B6", hover_color="#8E44AD", width=130)
        self.export_png_button.pack(side="left", padx=(0, 5))
        self.export_jpg_button = ctk.CTkButton(image_frame, text="📸 Exportar JPG", command=self.export_to_jpg, fg_color="#F39C12", hover_color="#E67E22", width=130)
        self.export_jpg_button.pack(side="right")
        
        # NEW: Search in table
        search_frame = ctk.CTkFrame(self.controls_frame, fg_color="transparent")
        search_frame.pack(fill="x", padx=10, pady=5)
        ctk.CTkLabel(search_frame, text="🔍 Buscar en lista:").pack(anchor="w")
        self.search_var = ctk.StringVar()
        # Use trace_add when available (Tk 8.6+/Tcl 9), fallback to trace for older versions
        try:
            self.search_var.trace_add("write", self.on_search_change)
        except Exception:
            try:
                # Older tkinter uses trace with mode 'w'
                self.search_var.trace("w", self.on_search_change)
            except Exception:
                # If both fail, bind the entry widget directly as a last resort
                # (we'll set this after creating the entry below)
                self._deferred_search_bind = True
        self.search_entry = ctk.CTkEntry(search_frame, textvariable=self.search_var, placeholder_text="Buscar productos...")
        self.search_entry.pack(fill="x", pady=(0, 5))
        # If trace binding wasn't possible, bind key release event to trigger search
        if getattr(self, '_deferred_search_bind', False):
            self.search_entry.bind('<KeyRelease>', lambda e: self.on_search_change())
        
        self.generate_button = ctk.CTkButton(self.controls_frame, text="🖼️ Generar y Guardar PNG", font=ctk.CTkFont(size=ui_scale(16), weight="bold"), command=self.save_generated_image, height=ui_scale(48)); self.generate_button.pack(side="bottom", fill="x", padx=ui_scale(10), pady=ui_scale(10))

    def create_table(self):
        self.table_frame.grid_rowconfigure(0, weight=1); self.table_frame.grid_columnconfigure(0, weight=1)
        style = ttk.Style(); style.theme_use("default")
        # MEJORADO: Aumentar significativamente el tamaño de fuente y altura de filas para mejor legibilidad
        style.configure("Treeview", background="#2b2b2b", foreground="white", rowheight=ui_scale(40), fieldbackground="#2b2b2b", bordercolor="#333333", borderwidth=0, font=('Calibri', ui_scale(14)))
        style.map('Treeview', background=[('selected', '#22559b')])
        style.configure("Treeview.Heading", background="#565b5e", foreground="white", relief="flat", font=('Calibri', ui_scale(16), 'bold'))
        style.map("Treeview.Heading", background=[('active', '#3484F0')])
        self.table = ttk.Treeview(self.table_frame, columns=("Marca", "Modelo", "Specs", "Precio"), show="headings")
        # MEJORADO: Aumentar el ancho de las columnas para acomodar el texto más grande
        for col, anchor, width in [("Marca", "w", 180), ("Modelo", "w", 250), ("Specs", "center", 200), ("Precio", "e", 180)]:
            self.table.heading(col, text=col.replace("Specs", "Especificaciones")); self.table.column(col, anchor=anchor, width=width)
        self.table.grid(row=0, column=0, sticky="nsew")
        scrollbar = ctk.CTkScrollbar(self.table_frame, command=self.table.yview); scrollbar.grid(row=0, column=1, sticky="ns")
        self.table.configure(yscrollcommand=scrollbar.set)
        
        # DOUBLE CLICK TO EDIT
        self.table.bind("<Double-1>", self.edit_active_item)

    def create_preview_panel(self):
        self.preview_frame.grid_rowconfigure(1, weight=1); self.preview_frame.grid_columnconfigure(0, weight=1)
        
        # Header controls
        header = ctk.CTkFrame(self.preview_frame, fg_color="transparent")
        header.grid(row=0, column=0, padx=ui_scale(10), pady=0, sticky="ew")
        
        title = ctk.CTkLabel(header, text="Vista Previa", font=ctk.CTkFont(size=ui_scale(18), weight="bold"))
        title.pack(side="top", anchor="center", pady=(10, 5))
        
        controls = ctk.CTkFrame(header, fg_color="transparent")
        controls.pack(side="top", pady=(0,5))
        
        ctk.CTkButton(controls, text="-", width=30, command=self.zoom_out).pack(side="left", padx=2)
        self.zoom_label = ctk.CTkLabel(controls, text="100%", width=45)
        self.zoom_label.pack(side="left", padx=2)
        ctk.CTkButton(controls, text="+", width=30, command=self.zoom_in).pack(side="left", padx=2)
        ctk.CTkButton(controls, text="Fit", width=40, command=self.reset_zoom, fg_color="gray").pack(side="left", padx=5)

        # Scrollable area
        self.preview_scroll = ctk.CTkScrollableFrame(self.preview_frame, label_text="")
        self.preview_scroll.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0,10))
        
        self.preview_label = ctk.CTkLabel(self.preview_scroll, text="", text_color="gray")
        self.preview_label.pack(expand=True, fill="both")

    def update_table(self, sort_data=True):
        if sort_data: self.products_data.sort(key=lambda x: (list(self.BRAND_COLORS.keys()).index(x['brand']) if x['brand'] in self.BRAND_COLORS else 99, x['model']))
        for item in self.table.get_children(): self.table.delete(item)
        for i, product in enumerate(self.products_data): self.table.insert("", "end", values=(product["brand"], product["model"], product["specs"], product["price_str"]))
        self.update_preview(); self.auto_save_project()

    def add_product(self):
        brand, model, specs, price_raw = self.brand_var.get(), self.model_entry.get().strip().upper(), self.specs_entry.get().strip().upper(), self.price_entry.get().strip()
        if not all([brand, model, price_raw]): messagebox.showerror("Error", "Marca, Modelo y Precio son obligatorios."); return
        try:
            price_float = float(price_raw.replace("RD$", "").replace(",", "")); price_str = f"RD${locale.format_string('%.2f', price_float, grouping=True)}"
        except ValueError: messagebox.showerror("Error", "El precio debe ser un número válido."); return
        new_product = {"id": f"{brand}-{model}-{specs}", "brand": brand, "model": model, "specs": specs, "price_float": price_float, "price_str": price_str}
        self.products_data.append(new_product); self.db.add_or_update_inventory(new_product); self.inventory_data = self.db.get_inventory()
        self.update_table()
        self.model_entry.delete(0, "end"); self.specs_entry.delete(0, "end"); self.price_entry.delete(0, "end"); self.model_entry.focus()

    def edit_active_item(self, event=None):
        selected_items = self.table.selection()
        if not selected_items:
            if not event: messagebox.showwarning("Sin Selección", "Selecciona un equipo para editar.")
            return

        item_id = selected_items[0]
        values = self.table.item(item_id)['values']
        
        # Find product in self.products_data that matches these values
        target_product = None
        for p in self.products_data:
            if p['brand'] == values[0] and p['model'] == values[1] and p['specs'] == values[2] and p['price_str'] == values[3]:
                target_product = p
                break
        
        if not target_product:
            messagebox.showerror("Error", "No se pudo encontrar el producto original para editar.")
            return

        # Create Edit Dialog
        dialog = ctk.CTkToplevel(self)
        dialog.title("Editar Producto")
        dialog.geometry("400x450")
        dialog.transient(self)
        dialog.grab_set()
        
        center_x = self.winfo_x() + (self.winfo_width() // 2) - 200
        center_y = self.winfo_y() + (self.winfo_height() // 2) - 225
        dialog.geometry(f"+{center_x}+{center_y}")
        
        # Fields
        ctk.CTkLabel(dialog, text="Marca:", font=("Arial", 12, "bold")).pack(pady=(15,5))
        brand_var = ctk.StringVar(value=target_product['brand'])
        brand_combo = ctk.CTkComboBox(dialog, values=list(self.BRAND_COLORS.keys()), variable=brand_var, width=250)
        brand_combo.pack(pady=5)
        
        ctk.CTkLabel(dialog, text="Modelo:", font=("Arial", 12, "bold")).pack(pady=(10,5))
        model_entry = ctk.CTkEntry(dialog, width=250)
        model_entry.insert(0, target_product['model'])
        model_entry.pack(pady=5)
        
        ctk.CTkLabel(dialog, text="Especificaciones:", font=("Arial", 12, "bold")).pack(pady=(10,5))
        specs_entry = ctk.CTkEntry(dialog, width=250)
        specs_entry.insert(0, target_product['specs'])
        specs_entry.pack(pady=5)
        
        ctk.CTkLabel(dialog, text="Precio:", font=("Arial", 12, "bold")).pack(pady=(10,5))
        price_entry = ctk.CTkEntry(dialog, width=250)
        # Simplified stripping to get raw number
        raw_price = str(target_product['price_float'])
        if raw_price.endswith(".0"): raw_price = raw_price[:-2]
        price_entry.insert(0, raw_price)
        price_entry.pack(pady=5)
        
        def save_changes():
            new_brand = brand_var.get()
            new_model = model_entry.get().strip().upper()
            new_specs = specs_entry.get().strip().upper()
            new_price_raw = price_entry.get().strip()
            
            try:
                # Clean price input
                clean_price = new_price_raw.replace("RD$", "").replace(",", "")
                new_price_float = float(clean_price)
                new_price_str = f"RD${locale.format_string('%.2f', new_price_float, grouping=True)}"
            except ValueError:
                messagebox.showerror("Error", "Precio inválido.", parent=dialog)
                return

            new_id = f"{new_brand}-{new_model}-{new_specs}"
            old_id = target_product['id']
            
            # Logic: If ID changed (meaning brand/model/specs changed), 
            # we treat it as a correction: remove old "wrong" item from DB, add new "correct" item.
            if new_id != old_id:
                # Remove old from DB
                self.db.delete_inventory_item(old_id)
                # Update product dict
                target_product['id'] = new_id
                target_product['brand'] = new_brand
                target_product['model'] = new_model
                target_product['specs'] = new_specs
            
            target_product['price_float'] = new_price_float
            target_product['price_str'] = new_price_str
            
            # Save to DB (add or update the new/current ID)
            self.db.add_or_update_inventory(target_product)
            
            # Update global inventory list in memory
            self.inventory_data = self.db.get_inventory()
            
            # Refresh Table
            self.update_table()
            dialog.destroy()

        ctk.CTkButton(dialog, text="Guardar Cambios", command=save_changes, fg_color="#27AE60", hover_color="#229954", width=200).pack(pady=30)

    def remove_from_active_list(self):
        selected_items = self.table.selection()
        if not selected_items: messagebox.showwarning("Sin Selección", "Selecciona un equipo para quitar de la lista."); return
        selected_products_values = [self.table.item(item)['values'] for item in selected_items]
        ids_to_remove = set()
        for values in selected_products_values: brand, model, specs, price_str = values; product_id = f"{brand}-{model}-{specs}"; ids_to_remove.add(product_id)
        self.products_data = [p for p in self.products_data if p['id'] not in ids_to_remove]
        self.update_table(sort_data=False)
        
    def update_config(self, path): self.current_project_path=path; open(CONFIG_FILE,'w').write(json.dumps({"last_project":path}))
    def auto_save_project(self):
        project_data = {"logo_path": self.logo_path, "product_ids": [p['id'] for p in self.products_data]}
        temp_path = self.current_project_path + ".tmp"
        try:
            with open(temp_path, 'w', encoding='utf-8') as f: json.dump(project_data, f, indent=4)
            os.replace(temp_path, self.current_project_path)
        except Exception:
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception: pass

    def save_project_as(self):
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON de Lista", "*.json")])
        if not path: return
        if os.path.basename(path).lower() in [DB_FILE.lower(), CONFIG_FILE.lower()]:
            messagebox.showerror("Nombre Reservado", "Ese nombre de archivo está reservado para el sistema."); return
        self.update_config(path); self.auto_save_project(); messagebox.showinfo("Éxito", f"Lista guardada como {os.path.basename(path)}")
        
    def load_project_manual(self):
        path = filedialog.askopenfilename(filetypes=[("JSON de Lista", "*.json")])
        if not path: return
        if os.path.basename(path).lower() in [DB_FILE.lower(), CONFIG_FILE.lower()]:
            messagebox.showerror("Archivo de Sistema", "No puedes cargar este archivo como una lista."); return
        if self.products_data and not messagebox.askyesno("Confirmar", "¿Descartar lista actual y cargar una nueva?"): return
        self.load_project_data(path)

    def load_last_project(self):
        path_to_load = "autosave.json"
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f: path_to_load = json.load(f).get("last_project", "autosave.json")
            except (json.JSONDecodeError, TypeError): pass
        self.load_project_data(path_to_load)
        
    def load_project_data(self, path):
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f: data = json.load(f)
                self.logo_path = data.get("logo_path", None); product_ids = data.get("product_ids", [])
                self.products_data = []
                if not isinstance(product_ids, list): product_ids = []
                inventory_lookup = {item['id']: item for item in self.inventory_data}
                for pid in product_ids:
                    if pid in inventory_lookup: self.products_data.append(inventory_lookup[pid].copy())
                self.update_config(path); self.update_table()
            except (json.JSONDecodeError, TypeError): self.products_data = []; self.update_table()
        else: self.products_data = []; self.update_table()

    def select_logo(self):
        path = filedialog.askopenfilename(filetypes=[("Imágenes", "*.png *.jpg")])
        if path: self.logo_path = path; self.update_preview(); self.auto_save_project()

    def create_image_canvas(self):
        grouped_products = {}; W = 1080; BG, TXT = "#FFFFFF", "#000000"
        for p in self.products_data: brand = p['brand']; grouped_products.setdefault(brand, []).append(p)
        
        # --- CALCULAR ALTURA DINÁMICA BASADA EN CONTENIDO REAL ---
        # Primero calculamos la altura necesaria para todo el contenido
        def calculate_required_height(grouped_products, fonts, spacing, brand_h, row_h):
            y = 200  # REDUCIDO: Altura inicial más compacta (logo + título + fecha)
            column_pixel_heights = [y, y]
            brand_heights = {brand: (brand_h + row_h + len(prods) * row_h + spacing) for brand, prods in grouped_products.items()}
            for brand_name in self.BRAND_COLORS.keys():
                if brand_name in brand_heights:
                    height = brand_heights[brand_name]
                    shortest_col_idx = 0 if column_pixel_heights[0] <= column_pixel_heights[1] else 1
                    column_pixel_heights[shortest_col_idx] += height
            return max(column_pixel_heights) + 20  # REDUCIDO: +20px de margen inferior (antes era 50)
        
        # Calcular altura con fuente base para determinar el tamaño necesario
        base_font_size = 20
        if self.font_paths:
            base_fonts = {
                "text": ImageFont.truetype(self.font_paths["regular"], base_font_size),
                "header": ImageFont.truetype(self.font_paths["bold"], base_font_size),
                "brand_header": ImageFont.truetype(self.font_paths["bold"], 28)
            }
            # REDUCIDO: Espaciados mucho más compactos para que todo quepa
            base_row_h = 25        # Reducido de 40 a 25
            base_brand_h = 30       # Reducido de 45 a 30
            base_spacing = 3       # Reducido de 10 a 3
            required_height = calculate_required_height(grouped_products, base_fonts, base_spacing, base_brand_h, base_row_h)
        else:
            required_height = 1500  # Altura por defecto si no hay fuentes
        
        # Usar la altura calculada o un mínimo de 1500px
        H = max(required_height, 1500)
        
        img = Image.new('RGBA', (W, H), BG)
        draw = ImageDraw.Draw(img)
        
        # --- Font and Spacing Auto-Adjustment Logic ---
        def get_layout_height(grouped_products, fonts, spacing, brand_h, row_h):
            y = 200  # REDUCIDO: Altura inicial más compacta
            column_pixel_heights = [y, y]
            brand_heights = {brand: (brand_h + row_h + len(prods) * row_h + spacing) for brand, prods in grouped_products.items()}
            for brand_name in self.BRAND_COLORS.keys():
                if brand_name in brand_heights:
                    height = brand_heights[brand_name]
                    shortest_col_idx = 0 if column_pixel_heights[0] <= column_pixel_heights[1] else 1
                    column_pixel_heights[shortest_col_idx] += height
            return max(column_pixel_heights)

        # MEJORADO: Usar la altura calculada dinámicamente para el ajuste de fuentes con espaciados compactos
        final_font_size = 20
        if self.font_paths:
            for size in range(20, 11, -1):
                scale_ratio = size / 20.0
                temp_fonts = { "text": ImageFont.truetype(self.font_paths["regular"], size), "header": ImageFont.truetype(self.font_paths["bold"], size), "brand_header": ImageFont.truetype(self.font_paths["bold"], int(28*scale_ratio))}
                # REDUCIDO: Espaciados más compactos para maximizar el uso del espacio
                temp_row_h = int(25 * scale_ratio); temp_brand_h = int(30 * scale_ratio); temp_spacing = int(3 * scale_ratio)
                # Usar la altura calculada dinámicamente (H) en lugar de una altura fija
                if get_layout_height(grouped_products, temp_fonts, temp_spacing, temp_brand_h, temp_row_h) < H - 40: final_font_size = size; break
            else: final_font_size = 12
        
        final_scale = final_font_size / 20.0
        if self.font_paths:
            font_brand_header = ImageFont.truetype(self.font_paths["bold"], int(28*final_scale)); font_main_title = ImageFont.truetype(self.font_paths["regular"], 26)
            font_table_header = ImageFont.truetype(self.font_paths["bold"], final_font_size); font_table_text = ImageFont.truetype(self.font_paths["regular"], final_font_size)
        else: font_brand_header, font_main_title, font_table_header, font_table_text = [ImageFont.load_default()]*4
        
        # REDUCIDO: Espaciados mucho más compactos para maximizar el uso del espacio
        row_height = int(25 * final_scale); brand_header_h = int(30 * final_scale); spacing_between_brands = int(3 * final_scale)

        # --- Logo Rendering ---
        y = 40
        if self.logo_path and os.path.exists(self.logo_path):
            try:
                logo = Image.open(self.logo_path).convert("RGBA")
                logo.thumbnail((180, 180), Image.Resampling.LANCZOS)
                logo_layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
                shadow_mask = logo.getchannel('A').filter(ImageFilter.GaussianBlur(4))
                logo_layer.paste((0, 0, 0, 100), (5, 5), mask=shadow_mask)
                logo_layer.paste(logo, (0, 0), mask=logo)
                x_pos = (W - logo.width) // 2
                img.paste(logo_layer, (x_pos, y), mask=logo_layer)
            except Exception as e:
                print(f"Error processing logo: {e}")
                draw.text((W//2, y+50), "LOGO NO VÁLIDO", fill="red", font=font_brand_header, anchor="ms")
        else:
            draw.text((W//2, y+50), "CARGAR LOGO", fill=TXT, font=font_brand_header, anchor="ms")
        
        y = 180; draw.text((50, y), "Listado de Precios por Mayor (Actualización Constante)", fill=TXT, font=font_main_title)
        date_txt = datetime.now().strftime("%d/%m/%Y")
        draw.text((W - font_main_title.getlength(date_txt) - 50, y), date_txt, fill=TXT, font=font_main_title); y += 30
        
        # --- Table Rendering Logic ---
        # Reduced column width to make boxes smaller and text more readable
        COLS, COL_W, SPACING = 2, (W - 200) // 2, 70
        brand_cols = [[] for _ in range(COLS)]; column_pixel_heights = [y] * COLS
        brand_heights = {brand: (brand_header_h + row_height + len(prods) * row_height + spacing_between_brands) for brand, prods in grouped_products.items()}
        for brand_name in self.BRAND_COLORS.keys():
            if brand_name in brand_heights:
                height = brand_heights[brand_name]
                shortest_col_idx = 0 if column_pixel_heights[0] <= column_pixel_heights[1] else 1
                brand_cols[shortest_col_idx].append(brand_name); column_pixel_heights[shortest_col_idx] += height
        
        final_col_heights = [y] * COLS
        for col_idx in range(COLS):
            start_x = 50 + col_idx * (COL_W + SPACING); y_pos = final_col_heights[col_idx]
            for brand_name in brand_cols[col_idx]:
                products = grouped_products.get(brand_name, []); color = self.BRAND_COLORS.get(brand_name, "#778899")
                draw.rectangle([start_x, y_pos, start_x + COL_W, y_pos + brand_header_h], fill=color)
                draw.text((start_x + COL_W / 2, y_pos + brand_header_h / 2), brand_name, fill="white", font=font_brand_header, anchor="mm")
                y_pos += brand_header_h
                if not products: continue
                # Re-adjusted column widths to give more space to PRECIO column
                model_width, spec_width = COL_W * 0.40, COL_W * 0.25
                col1_x, col2_x, col3_x = start_x, start_x + model_width, start_x + model_width + spec_width
                col_end_x = start_x + COL_W; border_color = "#DDDDDD"; header_y_start = y_pos; y_pos += row_height
                draw.text((col1_x + model_width/2, header_y_start + row_height/2), "MODELO", fill=TXT, font=font_table_header, anchor="mm")
                draw.text((col2_x + spec_width/2, header_y_start + row_height/2), "SPEC", fill=TXT, font=font_table_header, anchor="mm")
                draw.text((col3_x + (col_end_x - col3_x)/2, header_y_start + row_height/2), "PRECIO", fill=TXT, font=font_table_header, anchor="mm")
                table_start_y = header_y_start
                for p in products:
                    row_start_y = y_pos; y_pos += row_height
                    model_text = self.truncate_text(p['model'].upper(), font_table_text, model_width - 15)
                    spec_text = self.truncate_text(p['specs'].upper(), font_table_text, spec_width - 15)
                    # Give more space for price column (35% of remaining width)
                    price_width = (col_end_x - col3_x) - 15
                    price_text = self.truncate_text(p['price_str'], font_table_text, price_width)
                    draw.text((col1_x + model_width/2, row_start_y + row_height/2), model_text, fill=TXT, font=font_table_text, anchor="mm")
                    draw.text((col2_x + spec_width/2, row_start_y + row_height/2), spec_text, fill=TXT, font=font_table_text, anchor="mm")
                    draw.text((col3_x + (col_end_x-col3_x)/2, row_start_y + row_height/2), price_text, fill=TXT, font=font_table_text, anchor="mm")
                table_end_y = y_pos
                for i in range(len(products) + 2): draw.line([start_x, table_start_y + i * row_height, col_end_x, table_start_y + i * row_height], fill=border_color, width=1)
                draw.line([col2_x, table_start_y, col2_x, table_end_y], fill=border_color, width=1); draw.line([col3_x, table_start_y, col3_x, table_end_y], fill=border_color, width=1)
                draw.rectangle([start_x, table_start_y, col_end_x, table_end_y], outline=border_color, width=1)
                y_pos += spacing_between_brands
                final_col_heights[col_idx] = y_pos
        return img
        
    def truncate_text(self, text, font, max_width):
        if font.getlength(text) <= max_width: return text
        truncated_text = text
        while len(truncated_text) > 0:
            if font.getlength(truncated_text + '...') <= max_width: return truncated_text + '...';
            truncated_text = truncated_text[:-1]
        return '...'

    def update_preview(self):
        self.pil_preview_image = self.create_image_canvas()
        if not self.pil_preview_image: self.preview_label.configure(image=None, text="Añade productos para ver la vista previa."); return
        
        try:
            # Base width based on container (approximate if not visible yet)
            container_w = self.preview_scroll.winfo_width()
            if container_w < 50: container_w = 400
            
            # Subtract scrollbar/padding roughly
            base_w = container_w - 30
            
            target_w = int(base_w * self.preview_zoom)
            if target_w < 10: target_w = 10
            
            orig_w, orig_h = self.pil_preview_image.size
            ratio = orig_h / orig_w
            target_h = int(target_w * ratio)
            
            ctk_image = ctk.CTkImage(light_image=self.pil_preview_image, dark_image=self.pil_preview_image, size=(target_w, target_h))
            self.preview_label.configure(image=ctk_image, text="")
            self.zoom_label.configure(text=f"{int(self.preview_zoom*100)}%")
        except Exception as e:
            print(f"Error preview: {e}")
            self.preview_label.configure(image=None, text="Error")

    def zoom_in(self):
        self.preview_zoom += 0.1
        self.update_preview()
        
    def zoom_out(self):
        if self.preview_zoom > 0.2:
            self.preview_zoom -= 0.1
            self.update_preview()
            
    def reset_zoom(self):
        self.preview_zoom = 1.0
        self.update_preview()

    def save_generated_image(self):
        if not self.pil_preview_image: messagebox.showwarning("Sin Datos", "No hay nada que guardar."); return
        path = filedialog.asksaveasfilename(initialfile=f"lista_precios_{datetime.now().strftime('%Y-%m-%d')}.png", defaultextension=".png", filetypes=[("PNG", "*.png")])
        if not path: return
        
        rgb_image = self.pil_preview_image.convert('RGB')
        rgb_image.save(path)
        
        messagebox.showinfo("Éxito", f"Imagen guardada en:\n{path}")
        if sys.platform == "win32": 
            try: os.startfile(os.path.normpath(path))
            except Exception as e: print(f"Could not open file: {e}")
        else: 
            try: os.system(f'{"open" if sys.platform == "darwin" else "xdg-open"} "{path}"')
            except Exception as e: print(f"Could not open file: {e}")

    # NEW: Search functionality
    def on_search_change(self, *args):
        """Filter table based on search query"""
        query = self.search_var.get().lower().strip()
        if not query:
            self.filtered_products = self.products_data.copy()
        else:
            self.filtered_products = [
                p for p in self.products_data 
                if query in p['brand'].lower() or 
                   query in p['model'].lower() or 
                   query in p['specs'].lower() or 
                   query in p['price_str'].lower()
            ]
        self.update_filtered_table()
    
    def update_filtered_table(self):
        """Update table with filtered products"""
        for item in self.table.get_children():
            self.table.delete(item)
        for product in getattr(self, 'filtered_products', self.products_data):
            self.table.insert("", "end", values=(product["brand"], product["model"], product["specs"], product["price_str"]))

    # NEW: Export to Excel
    def export_to_excel(self):
        """Export current list to Excel"""
        if not self.products_data:
            messagebox.showwarning("Sin Datos", "No hay productos para exportar")
            return
            
        file_path = filedialog.asksaveasfilename(
            title="Exportar a Excel",
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")]
        )
        
        if file_path:
            try:
                import pandas as pd
                data = []
                for product in self.products_data:
                    data.append({
                        'Marca': product['brand'],
                        'Modelo': product['model'],
                        'Especificaciones': product['specs'],
                        'Precio': product['price_str']
                    })
                
                df = pd.DataFrame(data)
                df.to_excel(file_path, index=False)
                messagebox.showinfo("Éxito", f"Lista exportada a {file_path}")
                
            except Exception as e:
                messagebox.showerror("Error", f"Error al exportar: {str(e)}")

    # NEW: Export to PDF
    def export_to_pdf(self):
        """Export current list to PDF"""
        if not self.products_data:
            messagebox.showwarning("Sin Datos", "No hay productos para exportar")
            return
            
        file_path = filedialog.asksaveasfilename(
            title="Exportar a PDF",
            defaultextension=".pdf",
            filetypes=[("PDF files", "*.pdf")]
        )
        
        if file_path:
            try:
                from reportlab.pdfgen import canvas
                from reportlab.lib.pagesizes import letter
                
                c = canvas.Canvas(file_path, pagesize=letter)
                width, height = letter
                
                # Title
                c.setFont("Helvetica-Bold", 16)
                c.drawString(50, height - 50, "Lista de Precios")
                c.drawString(50, height - 70, f"Fecha: {datetime.now().strftime('%d/%m/%Y')}")
                
                # Headers
                y = height - 120
                c.setFont("Helvetica-Bold", 12)
                c.drawString(50, y, "Marca")
                c.drawString(150, y, "Modelo")
                c.drawString(300, y, "Especificaciones")
                c.drawString(450, y, "Precio")
                
                # Products
                c.setFont("Helvetica", 10)
                y -= 20
                for product in self.products_data:
                    if y < 50:  # New page if needed
                        c.showPage()
                        y = height - 50
                        c.setFont("Helvetica", 10)
                    
                    c.drawString(50, y, product['brand'][:15])
                    c.drawString(150, y, product['model'][:20])
                    c.drawString(300, y, product['specs'][:15])
                    c.drawString(450, y, product['price_str'])
                    y -= 15
                
                c.save()
                messagebox.showinfo("Éxito", f"Lista exportada a {file_path}")
                
            except Exception as e:
                messagebox.showerror("Error", f"Error al exportar: {str(e)}")

    # NEW: Export to PNG with options
    def export_to_png(self):
        """Export current list as PNG image"""
        if not self.pil_preview_image:
            messagebox.showwarning("Sin Datos", "Genera la vista previa primero")
            return
            
        file_path = filedialog.asksaveasfilename(
            title="Exportar como PNG",
            defaultextension=".png",
            filetypes=[("PNG files", "*.png")],
            initialfile=f"lista_precios_{datetime.now().strftime('%Y-%m-%d')}.png"
        )
        
        if file_path:
            try:
                # Save as PNG with transparency
                self.pil_preview_image.save(file_path, "PNG", optimize=True)
                messagebox.showinfo("Éxito", f"Imagen PNG guardada en:\n{file_path}")
                
                # Open file automatically
                if sys.platform == "win32":
                    try: os.startfile(os.path.normpath(file_path))
                    except Exception: pass
                    
            except Exception as e:
                messagebox.showerror("Error", f"Error al exportar PNG: {str(e)}")

    # NEW: Export to JPG with quality options
    def export_to_jpg(self):
        """Export current list as JPG image"""
        if not self.pil_preview_image:
            messagebox.showwarning("Sin Datos", "Genera la vista previa primero")
            return
            
        file_path = filedialog.asksaveasfilename(
            title="Exportar como JPG",
            defaultextension=".jpg",
            filetypes=[("JPG files", "*.jpg"), ("JPEG files", "*.jpeg")],
            initialfile=f"lista_precios_{datetime.now().strftime('%Y-%m-%d')}.jpg"
        )
        
        if file_path:
            try:
                # Convert to RGB for JPG (remove transparency)
                rgb_image = self.pil_preview_image.convert('RGB')
                
                # Save with high quality
                rgb_image.save(file_path, "JPEG", quality=95, optimize=True)
                messagebox.showinfo("Éxito", f"Imagen JPG guardada en:\n{file_path}")
                
                # Open file automatically
                if sys.platform == "win32":
                    try: os.startfile(os.path.normpath(file_path))
                    except Exception: pass
                    
            except Exception as e:
                messagebox.showerror("Error", f"Error al exportar JPG: {str(e)}")

if __name__ == "__main__":
    app = PriceListApp()
    app.mainloop()
