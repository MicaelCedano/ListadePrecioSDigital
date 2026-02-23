
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Edit, Plus, GripVertical, Search, Download, Image as ImageIcon, Save, Loader2, Upload, X, Palette } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';

// DnD Kit imports
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Types
type Brand = {
    name: string;
    color: string;
    order_index: number;
};

type Product = {
    id: string;
    brand: string;
    model: string;
    specs: string;
    price_float: number;
    price_str: string;
};

function SortableBrandItem({ brand, onDelete }: { brand: Brand; onDelete: (name: string) => void }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: brand.name });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-3 p-3 bg-card border rounded-lg shadow-sm ${isDragging ? 'opacity-50 ring-2 ring-primary' : ''}`}
        >
            <div {...attributes} {...listeners} className="cursor-grab hover:text-primary transition-colors">
                <GripVertical className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="w-6 h-6 rounded-full border" style={{ backgroundColor: brand.color }} />
            <span className="flex-1 font-medium">{brand.name}</span>
            <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(brand.name)}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

export default function Home() {
    // State
    const [brands, setBrands] = useState<Brand[]>([]);
    const [inventory, setInventory] = useState<Product[]>([]);
    const [activeList, setActiveList] = useState<Product[]>([]);
    const [logo, setLogo] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Selection State
    const [selectedBrand, setSelectedBrand] = useState<string>("");
    const [newModel, setNewModel] = useState("");
    const [newSpecs, setNewSpecs] = useState("");
    const [newPrice, setNewPrice] = useState("");

    // Brand Management State
    const [isBrandsDialogOpen, setIsBrandsDialogOpen] = useState(false);
    const [newBrandName, setNewBrandName] = useState("");
    const [newBrandColor, setNewBrandColor] = useState("#3b82f6");

    // Filter Inventory Dialog State
    const [inventorySearch, setInventorySearch] = useState("");
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);

    // Load Data & Persistence
    useEffect(() => {
        fetchData();
        // Load saved state from local storage
        const savedList = localStorage.getItem('priceList_activeList');
        const savedLogo = localStorage.getItem('priceList_logo');

        if (savedList) {
            try {
                setActiveList(JSON.parse(savedList));
                toast.success("Progreso restaurado");
            } catch (e) {
                console.error("Failed to parse saved list");
            }
        }

        if (savedLogo) {
            setLogo(savedLogo);
        }

        setIsInitialized(true);
    }, []);

    // Save state changes
    useEffect(() => {
        if (!isInitialized) return;
        localStorage.setItem('priceList_activeList', JSON.stringify(activeList));
        // Optional: Show saving indicator
    }, [activeList, isInitialized]);

    useEffect(() => {
        if (!isInitialized) return;
        if (logo) {
            localStorage.setItem('priceList_logo', logo);
        } else {
            localStorage.removeItem('priceList_logo');
        }
    }, [logo, isInitialized]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [brandsRes, inventoryRes] = await Promise.all([
                fetch('/api/brands'),
                fetch('/api/inventory')
            ]);
            const brandsData = await brandsRes.json();
            const inventoryData = await inventoryRes.json();

            setBrands(brandsData);
            setInventory(inventoryData);
            if (brandsData.length > 0) setSelectedBrand(brandsData[0].name);
        } catch (error) {
            toast.error("Error cargando datos");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEndBrands = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = brands.findIndex((b) => b.name === active.id);
            const newIndex = brands.findIndex((b) => b.name === over.id);

            const newBrands = arrayMove(brands, oldIndex, newIndex).map((brand, index) => ({
                ...brand,
                order_index: index
            }));

            setBrands(newBrands);

            try {
                await fetch('/api/brands', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ brands: newBrands })
                });
                toast.success("Orden de marcas actualizado");
            } catch (error) {
                toast.error("Error al guardar el orden");
                fetchData(); // Revert on failure
            }
        }
    };

    const handleAddBrand = async () => {
        if (!newBrandName.trim()) {
            toast.error("Ingrese un nombre para la marca");
            return;
        }

        const name = newBrandName.trim().toUpperCase();
        if (brands.some(b => b.name === name)) {
            toast.error("Esta marca ya existe");
            return;
        }

        const newBrand: Brand = {
            name,
            color: newBrandColor,
            order_index: brands.length
        };

        try {
            await fetch('/api/brands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newBrand)
            });
            setBrands([...brands, newBrand]);
            setNewBrandName("");
            toast.success("Marca agregada");
        } catch (error) {
            toast.error("Error al agregar marca");
        }
    };

    const handleDeleteBrand = async (name: string) => {
        try {
            await fetch(`/api/brands?name=${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            setBrands(brands.filter(b => b.name !== name));
            toast.success("Marca eliminada");
        } catch (error) {
            toast.error("Error al eliminar marca");
        }
    };

    const handleAddProduct = async () => {
        if (!selectedBrand || !newModel || !newPrice) {
            toast.error("Completa los campos obligatorios");
            return;
        }

        const priceFloat = parseFloat(newPrice.replace(/[^\d.]/g, ''));
        if (isNaN(priceFloat)) {
            toast.error("Precio inválido");
            return;
        }

        const priceStr = `RD$${priceFloat.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;
        const id = `${selectedBrand}-${newModel}-${newSpecs}`.toUpperCase(); // Simple ID generation

        const newProduct: Product = {
            id,
            brand: selectedBrand,
            model: newModel.toUpperCase(),
            specs: newSpecs.toUpperCase(),
            price_float: priceFloat,
            price_str: priceStr
        };

        // Optimistically update UI
        const updatedInventory = [...inventory.filter(p => p.id !== id), newProduct];
        setInventory(updatedInventory);

        // Add to active list directly as well (assuming user wants to add it immediately)
        setActiveList(prev => [...prev, newProduct]);

        try {
            await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProduct)
            });
            toast.success("Producto agregado");

            // Reset fields
            setNewModel("");
            setNewSpecs("");
            setNewPrice("");
        } catch (error) {
            toast.error("Error guardando en base de datos");
        }
    };

    const addToActiveList = (product: Product) => {
        if (activeList.some(p => p.id === product.id)) {
            toast.warning("El producto ya está en la lista active");
            return;
        }
        setActiveList([...activeList, product]);
        toast.success("Agregado a la lista active");
    };

    const removeFromActiveList = (id: string) => {
        setActiveList(activeList.filter(p => p.id !== id));
    };

    const filteredInventory = inventory.filter(item =>
        item.brand.toLowerCase().includes(inventorySearch.toLowerCase()) ||
        item.model.toLowerCase().includes(inventorySearch.toLowerCase()) ||
        item.specs.toLowerCase().includes(inventorySearch.toLowerCase())
    ).sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));

    // Visual Grouping for Preview
    const groupedActiveList = activeList.reduce((acc, product) => {
        if (!acc[product.brand]) acc[product.brand] = [];
        acc[product.brand].push(product);
        return acc;
    }, {} as Record<string, Product[]>);

    // Sort groups by brand order
    const sortedBrands = [...brands].sort((a, b) => a.order_index - b.order_index).map(b => b.name);
    const sortedGroupKeys = Object.keys(groupedActiveList).sort((a, b) => {
        const idxA = sortedBrands.indexOf(a);
        const idxB = sortedBrands.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            toast.error("La imagen es muy grande (Max 2MB)");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setLogo(reader.result as string);
            toast.success("Logo cargado");
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveLogo = () => {
        setLogo(null);
        toast.info("Logo removido");
    };

    const handleExportImage = async () => {
        const element = document.getElementById('preview-capture-area');
        const wrapper = document.getElementById('preview-wrapper');

        if (!element || !wrapper) {
            toast.error("Error: No se encontró el área de vista previa");
            return;
        }

        setExporting(true);
        const toastId = toast.loading("Generando imagen de alta calidad...");

        // Store original styles
        const originalTransform = wrapper.style.transform;
        const originalMargin = wrapper.style.marginBottom;

        try {
            // 1. Reset scale to 100% so html2canvas captures native pixels
            wrapper.style.transform = 'scale(1)';
            wrapper.style.marginBottom = '0';
            // We use absolute positioning to prevent the layout from "exploding" visually and scrolling the page
            wrapper.style.position = 'fixed';
            wrapper.style.top = '0';
            wrapper.style.left = '0';
            wrapper.style.zIndex = '-50'; // Move behind, but visible to DOM

            // Small delay to let DOM render the style change
            await new Promise(resolve => setTimeout(resolve, 100));

            const canvas = await html2canvas(element, {
                scale: 1, // Capture at 1:1 of the 1080px width (which is now actual size)
                backgroundColor: "#ffffff",
                useCORS: true,
                logging: false,
                windowWidth: 1080,
            });

            const image = canvas.toDataURL("image/png");

            // Create download link
            const link = document.createElement('a');
            link.href = image;
            link.download = `lista_precios_${new Date().toISOString().split('T')[0]}.png`;
            link.click();

            toast.success("Imagen guardada exitosamente", { id: toastId });
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Error al generar la imagen", { id: toastId });
        } finally {
            // Restore original styles
            wrapper.style.transform = originalTransform;
            wrapper.style.marginBottom = originalMargin;
            wrapper.style.position = '';
            wrapper.style.top = '';
            wrapper.style.left = '';
            wrapper.style.zIndex = '';
            setExporting(false);
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {/* Sidebar / Controls Panel */}
            <aside className="w-80 border-r bg-card p-4 flex flex-col gap-4 overflow-y-auto">
                <h1 className="text-xl font-bold mb-4">Gestor de Precios</h1>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Nuevo Producto</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <Label>Marca</Label>
                            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar Marca" />
                                </SelectTrigger>
                                <SelectContent>
                                    {brands.map(brand => (
                                        <SelectItem key={brand.name} value={brand.name}>
                                            {brand.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Modelo</Label>
                            <Input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Ej: GALAXY S24" />
                        </div>
                        <div className="space-y-1">
                            <Label>Specs</Label>
                            <Input value={newSpecs} onChange={e => setNewSpecs(e.target.value)} placeholder="Ej: 128GB / 8GB" />
                        </div>
                        <div className="space-y-1">
                            <Label>Precio</Label>
                            <Input value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Ej: 45000" type="number" />
                        </div>
                        <Button onClick={handleAddProduct} className="w-full">
                            <Plus className="mr-2 h-4 w-4" /> Agregar
                        </Button>
                    </CardContent>
                </Card>

                <div className="flex flex-col gap-2">
                    <Button variant="secondary" onClick={() => setIsInventoryOpen(true)}>
                        <Search className="mr-2 h-4 w-4" /> Buscar en Inventario
                    </Button>

                    <Button variant="outline">
                        <Save className="mr-2 h-4 w-4" /> Guardar Lista
                    </Button>

                    <Button variant="outline" onClick={() => setIsBrandsDialogOpen(true)}>
                        <Palette className="mr-2 h-4 w-4" /> Gestionar Marcas
                    </Button>

                    <div className="relative">
                        <input
                            type="file"
                            id="logo-upload"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLogoUpload}
                        />
                        <Button variant="outline" className="w-full" onClick={() => document.getElementById('logo-upload')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> {logo ? "Cambiar Logo" : "Subir Logo"}
                        </Button>
                        {logo && (
                            <Button variant="ghost" size="icon" className="absolute right-0 top-0 text-destructive" onClick={handleRemoveLogo}>
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>

                    <Button variant="default" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleExportImage} disabled={exporting}>
                        {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                        Generar Imagen
                    </Button>
                    <Button variant="destructive" onClick={() => setActiveList([])}>
                        <Trash2 className="mr-2 h-4 w-4" /> Limpiar Lista
                    </Button>
                </div>

                {/* Inventory Dialog */}
                <Dialog open={isInventoryOpen} onOpenChange={setIsInventoryOpen}>
                    <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle>Inventario Global</DialogTitle>
                        </DialogHeader>
                        <div className="flex items-center space-x-2 py-4">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Filtrar por nombre, marca..."
                                value={inventorySearch}
                                onChange={(e) => setInventorySearch(e.target.value)}
                                className="flex-1"
                            />
                        </div>
                        <ScrollArea className="flex-1 border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Marca</TableHead>
                                        <TableHead>Modelo</TableHead>
                                        <TableHead>Specs</TableHead>
                                        <TableHead className="text-right">Precio</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredInventory.map((item) => (
                                        <TableRow key={item.id} className="group">
                                            <TableCell className="font-medium">{item.brand}</TableCell>
                                            <TableCell>{item.model}</TableCell>
                                            <TableCell className="text-muted-foreground">{item.specs}</TableCell>
                                            <TableCell className="text-right font-mono text-green-500">{item.price_str}</TableCell>
                                            <TableCell>
                                                <Button size="icon" variant="ghost" onClick={() => addToActiveList(item)}>
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {filteredInventory.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                No se encontraron resultados.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>

                {/* Brands Management Dialog */}
                <Dialog open={isBrandsDialogOpen} onOpenChange={setIsBrandsDialogOpen}>
                    <DialogContent className="max-w-md h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle>Gestionar y Ordenar Marcas</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-4 py-4 border-b">
                            <div className="flex gap-2">
                                <div className="flex-1 space-y-1">
                                    <Label>Nueva Marca</Label>
                                    <Input
                                        placeholder="Nombre (ej: SAMSUNG)"
                                        value={newBrandName}
                                        onChange={(e) => setNewBrandName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddBrand()}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Color</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            type="color"
                                            className="w-12 h-10 p-1 cursor-pointer"
                                            value={newBrandColor}
                                            onChange={(e) => setNewBrandColor(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-end">
                                    <Button size="icon" onClick={handleAddBrand}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <ScrollArea className="flex-1 pt-4">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEndBrands}
                            >
                                <SortableContext
                                    items={brands.map(b => b.name)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-2 pb-6">
                                        {brands.map((brand) => (
                                            <SortableBrandItem
                                                key={brand.name}
                                                brand={brand}
                                                onDelete={handleDeleteBrand}
                                            />
                                        ))}
                                        {brands.length === 0 && (
                                            <p className="text-center text-muted-foreground py-10">No hay marcas registradas.</p>
                                        )}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-muted/20 p-6 gap-6 overflow-hidden">

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                    {/* Active List Panel */}
                    <Card className="flex flex-col h-full overflow-hidden border-0 shadow-lg bg-card/50 backdrop-blur-sm">
                        <CardHeader className="bg-card border-b py-3">
                            <CardTitle className="text-lg flex justify-between items-center">
                                Lista Activa ({activeList.length} items)
                            </CardTitle>
                        </CardHeader>
                        <div className="flex-1 overflow-auto p-0">
                            <Table>
                                <TableHeader className="sticky top-0 bg-card z-10">
                                    <TableRow>
                                        <TableHead>Producto</TableHead>
                                        <TableHead className="text-right">Precio</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {activeList.map((item, index) => (
                                        <TableRow key={`${item.id}-${index}`}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-primary">{item.brand} {item.model}</span>
                                                    <span className="text-xs text-muted-foreground">{item.specs}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-medium">{item.price_str}</TableCell>
                                            <TableCell>
                                                <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeFromActiveList(item.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {activeList.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <Save className="h-8 w-8 opacity-20" />
                                                    <p>Tu lista está vacía.</p>
                                                    <p className="text-xs">El progreso se guarda automáticamente.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>

                    {/* Preview Panel  */}
                    <Card className="flex flex-col h-full overflow-hidden border-0 shadow-lg bg-zinc-100 text-black relative">
                        <div className="absolute top-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded z-10 pointer-events-none">Vista Previa HD (1080px)</div>
                        {/* Scroll container */}
                        <div className="flex-1 overflow-auto bg-zinc-200/50 flex flex-col items-center py-8">
                            {/* Scale wrapper */}
                            <div id="preview-wrapper" className="relative" style={{ width: '1080px', height: 'fit-content', transform: 'scale(0.5)', transformOrigin: 'top center', marginBottom: '-50%' }}>
                                <div id="preview-capture-area" className="w-[1080px] bg-white shadow-2xl flex flex-col min-h-[1000px]">
                                    {/* Header Placeholder or Logo */}
                                    <div className="h-48 bg-white flex items-center justify-center mb-4 relative p-4">
                                        {logo ? (
                                            <img
                                                src={logo}
                                                alt="Logo"
                                                className=""
                                                style={{
                                                    maxHeight: '100%',
                                                    maxWidth: '100%',
                                                    width: 'auto',
                                                    height: 'auto',
                                                }}
                                            />
                                        ) : (
                                            <div className="text-center w-full h-full bg-zinc-50 flex flex-col items-center justify-center border-b-2 border-zinc-100">
                                                <ImageIcon className="h-12 w-12 text-zinc-300 mx-auto mb-2" />
                                                <span className="text-zinc-400 text-xl font-bold tracking-widest">[ LOGO ]</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Content Grid */}
                                    <div className="p-8 columns-2 gap-8 space-y-8">
                                        {sortedGroupKeys.map(brandName => {
                                            const brandColor = brands.find(b => b.name === brandName)?.color || "#000";
                                            return (
                                                <div key={brandName} className="break-inside-avoid-column mb-8 bg-white rounded-xl overflow-hidden border border-zinc-100 shadow-sm">
                                                    {/* Brand Header */}
                                                    <div
                                                        className="text-white px-6 py-3 font-black text-2xl uppercase tracking-wider text-center"
                                                        style={{ backgroundColor: brandColor }}
                                                    >
                                                        {brandName}
                                                    </div>

                                                    {/* Products List */}
                                                    <div className="p-5 bg-white">
                                                        {groupedActiveList[brandName].map((item, idx) => (
                                                            <div key={idx} className="flex justify-between items-baseline py-2.5 border-b border-gray-100 last:border-0 hover:bg-zinc-50/50">
                                                                <div className="flex items-baseline gap-2 pr-4 flex-1">
                                                                    <span className="font-bold text-zinc-800 text-xl leading-none">
                                                                        {item.model}
                                                                    </span>
                                                                    {item.specs && (
                                                                        <span className="text-base text-zinc-500 font-medium whitespace-nowrap">{item.specs}</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-right shrink-0">
                                                                    <span className="font-black text-xl text-zinc-900 leading-none">
                                                                        {item.price_str}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {activeList.length === 0 && (
                                        <div className="flex-1 flex items-center justify-center text-gray-300 p-20 h-fit">
                                            <Save className="h-32 w-32 mb-8 opacity-20" />
                                            <p className="text-4xl font-light italic">Lista de Precios Vacía</p>
                                        </div>
                                    )}

                                    {/* Footer */}
                                    <div className="mt-auto py-8 text-center text-zinc-400 text-base font-medium border-t border-zinc-100 mx-12">
                                        Generado automáticamente • {new Date().toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </main>
        </div>
    );
}
