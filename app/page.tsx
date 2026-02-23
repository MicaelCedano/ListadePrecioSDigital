
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
import { Trash2, Edit, Plus, GripVertical, Search, Download, Image as ImageIcon, Save, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
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

export default function Home() {
    // State
    const [brands, setBrands] = useState<Brand[]>([]);
    const [inventory, setInventory] = useState<Product[]>([]);
    const [activeList, setActiveList] = useState<Product[]>([]);
    const [logo, setLogo] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [isClient, setIsClient] = useState(false);
    const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

    // Selection State
    const [selectedBrand, setSelectedBrand] = useState<string>("");
    const [newModel, setNewModel] = useState("");
    const [newSpecs, setNewSpecs] = useState("");
    const [newPrice, setNewPrice] = useState("");

    // Filter Inventory Dialog State
    const [inventorySearch, setInventorySearch] = useState("");
    const [isInventoryOpen, setIsInventoryOpen] = useState(false);

    // Initial Mount
    useEffect(() => {
        setIsClient(true);
        // Initialize fetch
        const init = async () => {
            await Promise.all([fetchData(), loadSettings()]);
            setIsSettingsLoaded(true);
        };
        init();
    }, []);

    const loadSettings = async () => {
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const settings = await res.json();
                if (settings.activeList) setActiveList(settings.activeList);
                if (settings.logo) setLogo(settings.logo);
            }
        } catch (e) {
            console.error("Failed to load settings from DB", e);
            // Fallback to localStorage if DB fails? 
            // Existing logic below handles localStorage read on mount, but we effectively overwrite it if DB succeeds.
            // If DB fails, we might want to rely on localStorage.
            // But let's keep the localStorage logic as a "cache" that runs immediately, 
            // and DB updates it when ready.
        }
    };

    // Load saved state from local storage safely (Instant load, then DB syncs)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedList = localStorage.getItem('priceList_activeList');
            const savedLogo = localStorage.getItem('priceList_logo');
            if (savedList) {
                try { setActiveList(JSON.parse(savedList)); } catch (e) { }
            }
            if (savedLogo) setLogo(savedLogo);
        }
    }, []);

    // Save state changes (Sync with DB)
    useEffect(() => {
        if (!isClient || !isSettingsLoaded) return;

        localStorage.setItem('priceList_activeList', JSON.stringify(activeList));

        const timer = setTimeout(async () => {
            try {
                console.log("Saving activeList to DB...", activeList.length, "items");
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'activeList', value: activeList })
                });
                if (!res.ok) throw new Error("Server response not ok");
                console.log("activeList saved successfully");
                toast.success("Lista sincronizada en la nube", { duration: 1000, id: 'sync-list-ok' });
            } catch (e) {
                console.error("Failed to save activeList to DB", e);
                toast.error("Error sincronizando lista");
            }
        }, 2000); // 2 second debounce
        return () => clearTimeout(timer);
    }, [activeList, isClient, isSettingsLoaded]);

    useEffect(() => {
        if (!isClient || !isSettingsLoaded) return;

        if (logo) {
            localStorage.setItem('priceList_logo', logo);
        } else {
            localStorage.removeItem('priceList_logo');
        }

        const timer = setTimeout(async () => {
            try {
                console.log("Saving logo to DB...");
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'logo', value: logo })
                });
                if (!res.ok) throw new Error("Server response not ok");
                console.log("Logo saved successfully");
                toast.success("Logo sincronizado en la nube", { duration: 1000, id: 'sync-logo-ok' });
            } catch (e) {
                console.error("Failed to save logo to DB", e);
            }
        }, 3000); // 3 second debounce for logo since it's larger
        return () => clearTimeout(timer);
    }, [logo, isClient, isSettingsLoaded]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [brandsRes, inventoryRes] = await Promise.all([
                fetch('/api/brands'),
                fetch('/api/inventory')
            ]);

            if (!brandsRes.ok || !inventoryRes.ok) throw new Error("Failed to fetch data");

            const brandsData = await brandsRes.json();
            const inventoryData = await inventoryRes.json();

            setBrands(brandsData || []);
            setInventory(inventoryData || []);
            if (brandsData && brandsData.length > 0) setSelectedBrand(brandsData[0].name);
        } catch (error) {
            console.error(error);
            // Don't show toast on initial load to avoid hydration errors or spam
        } finally {
            setLoading(false);
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
        const id = `${selectedBrand}-${newModel}-${newSpecs}`.toUpperCase().replace(/\s+/g, '-'); // Cleaner IDs

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

    // Sort groups by brand order (brands state is already kept in order)
    const sortedBrands = brands.map(b => b.name);
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

    // Brand Management State
    const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
    const [newBrandName, setNewBrandName] = useState("");
    const [newBrandColor, setNewBrandColor] = useState("#000000");

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleBrandReorder = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = brands.findIndex((b) => b.name === active.id);
            const newIndex = brands.findIndex((b) => b.name === over.id);

            const newOrderedBrands = arrayMove(brands, oldIndex, newIndex);
            setBrands(newOrderedBrands);

            // Save to DB
            try {
                const res = await fetch('/api/brands', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'reorder',
                        brands: newOrderedBrands.map(b => b.name)
                    })
                });

                if (!res.ok) throw new Error("Error guardando el orden");
                toast.success("Orden de marcas actualizado");
            } catch (error) {
                console.error(error);
                toast.error("Error al sincronizar el orden de las marcas");
                fetchData(); // Rollback
            }
        }
    };

    const handleAddBrand = async () => {
        if (!newBrandName) {
            toast.error("El nombre de la marca es requerido");
            return;
        }

        try {
            const res = await fetch('/api/brands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newBrandName.toUpperCase(), color: newBrandColor })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Error creando marca");
            }

            toast.success("Marca creada exitosamente");
            setNewBrandName("");
            setNewBrandColor("#000000");
            fetchData(); // Refresh data
        } catch (error: any) {
            toast.error(error.message);
        }
    };

    const handleDeleteBrand = async (brandName: string) => {
        if (!confirm(`¿Estás seguro de eliminar la marca ${brandName}? Se borrarán todos sus productos.`)) return;

        try {
            const res = await fetch(`/api/brands?name=${encodeURIComponent(brandName)}`, {
                method: 'DELETE'
            });

            if (!res.ok) throw new Error("Error eliminando marca");

            toast.success("Marca eliminada");
            fetchData(); // Refresh data
        } catch (error) {
            toast.error("No se pudo eliminar la marca");
        }
    };

    // Product Editing State
    const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    // Reuse newModel, newSpecs, newPrice, selectedBrand for editing form as well

    const handleEditProductClick = (product: Product) => {
        setEditingProduct(product);
        setSelectedBrand(product.brand);
        setNewModel(product.model);
        setNewSpecs(product.specs || "");
        setNewPrice(product.price_float.toString());
        setIsEditProductDialogOpen(true);
    };

    const handleUpdateProduct = async () => {
        if (!editingProduct || !selectedBrand || !newModel || !newPrice) {
            toast.error("Completa los campos obligatorios");
            return;
        }

        const priceFloat = parseFloat(newPrice.replace(/[^\d.]/g, ''));
        if (isNaN(priceFloat)) {
            toast.error("Precio inválido");
            return;
        }

        const priceStr = `RD$${priceFloat.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`;

        // Ensure consistent ID generation even with empty specs
        let rawId = `${selectedBrand}-${newModel}`;
        if (newSpecs) rawId += `-${newSpecs}`;

        const newId = rawId.toUpperCase().replace(/\s+/g, '-');

        const updatedProduct: Product = {
            id: newId,
            brand: selectedBrand,
            model: newModel.toUpperCase(),
            specs: newSpecs.toUpperCase(),
            price_float: priceFloat,
            price_str: priceStr
        };

        try {
            // Delete old if ID changed
            if (newId !== editingProduct.id) {
                await fetch(`/api/inventory?id=${encodeURIComponent(editingProduct.id)}`, { method: 'DELETE' });
            }

            // Upsert (Insert/Update)
            await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedProduct)
            });

            // Update local state
            fetchData();

            // Update active list if it contains the product
            setActiveList(prev => prev.map(p => p.id === editingProduct.id ? updatedProduct : p));

            toast.success("Producto actualizado");
            setIsEditProductDialogOpen(false);

            // Cleanup form
            setEditingProduct(null);
            setNewModel("");
            setNewSpecs("");
            setNewPrice("");
        } catch (error) {
            toast.error("Error actualizando producto");
            console.error(error);
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground overflow-hidden">
            {/* Sidebar / Controls Panel */}
            <aside className="w-80 border-r bg-card p-4 flex flex-col gap-4 overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-xl font-bold">Gestor de Precios</h1>
                    <Button variant="ghost" size="icon" onClick={() => setIsBrandDialogOpen(true)} title="Gestionar Marcas">
                        <Edit className="h-4 w-4" />
                    </Button>
                </div>

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
                            <Input value={newSpecs} onChange={e => setNewSpecs(e.target.value)} placeholder="Ej: 128GB" />
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
                                        <TableHead className="w-[100px]"></TableHead>
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
                                                <div className="flex items-center">
                                                    <Button size="icon" variant="ghost" onClick={() => handleEditProductClick(item)} title="Editar">
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="icon" variant="ghost" onClick={() => addToActiveList(item)} title="Agregar a Lista">
                                                        <Plus className="h-4 w-4" />
                                                    </Button>
                                                </div>
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

                {/* Edit Product Dialog */}
                <Dialog open={isEditProductDialogOpen} onOpenChange={setIsEditProductDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Editar Producto</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3 py-4">
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
                                <Input value={newSpecs} onChange={e => setNewSpecs(e.target.value)} placeholder="Ej: 128GB" />
                            </div>
                            <div className="space-y-1">
                                <Label>Precio</Label>
                                <Input value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Ej: 45000" type="number" />
                            </div>
                            <Button onClick={handleUpdateProduct} className="w-full">
                                Guardar Cambios
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Brands Dialog */}
                <Dialog open={isBrandDialogOpen} onOpenChange={setIsBrandDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Gestionar Marcas</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="flex gap-2 items-end">
                                <div className="space-y-1 flex-1">
                                    <Label>Nombre de Marca</Label>
                                    <Input
                                        value={newBrandName}
                                        onChange={(e) => setNewBrandName(e.target.value)}
                                        placeholder="Ej: SAMSUNG"
                                    />
                                </div>
                                <div className="space-y-1 w-20">
                                    <Label>Color</Label>
                                    <Input
                                        type="color"
                                        value={newBrandColor}
                                        onChange={(e) => setNewBrandColor(e.target.value)}
                                        className="h-10 p-1 cursor-pointer"
                                    />
                                </div>
                                <Button onClick={handleAddBrand}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            <ScrollArea className="h-[400px] border rounded p-2">
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleBrandReorder}
                                >
                                    <SortableContext
                                        items={brands.map(b => b.name)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <div className="space-y-2">
                                            {brands.map((brand) => (
                                                <SortableBrandItem
                                                    key={brand.name}
                                                    brand={brand}
                                                    onDelete={() => handleDeleteBrand(brand.name)}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </ScrollArea>
                        </div>
                    </DialogContent>
                </Dialog>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-muted/20 p-6 gap-6 overflow-hidden">
                {/* ... rest of the main content ... */}
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
                                        <TableHead className="w-[100px]"></TableHead>
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
                                                <div className="flex items-center justify-end">
                                                    <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-primary" onClick={() => handleEditProductClick(item)}>
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeFromActiveList(item.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
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

function SortableBrandItem({ brand, onDelete }: { brand: Brand, onDelete: () => void }) {
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
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center justify-between p-2 bg-muted rounded border group"
        >
            <div className="flex items-center gap-2">
                <button
                    className="cursor-grab active:cursor-grabbing text-muted-foreground p-1 hover:bg-muted-foreground/10 rounded"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: brand.color }}></div>
                <span className="font-medium">{brand.name}</span>
            </div>
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive h-8 w-8 p-0"
                onClick={onDelete}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}
