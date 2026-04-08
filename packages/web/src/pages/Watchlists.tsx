import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { Plus, List, GripVertical, MoreHorizontal, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SecurityAvatar } from '@/components/shared/SecurityAvatar';
import { formatDate } from '@/lib/formatters';
import {
  useWatchlists,
  useCreateWatchlist,
  useUpdateWatchlist,
  useDeleteWatchlist,
  useDuplicateWatchlist,
  useReorderWatchlists,
  useRemoveWatchlistSecurity,
  useAddWatchlistSecurity,
  type Watchlist,
} from '@/api/use-watchlists';
import { AddSecurityToWatchlistDialog } from '@/components/domain/AddSecurityToWatchlistDialog';
import { AddInstrumentDialog } from '@/components/domain/AddInstrumentDialog';
import { SecurityEditor, type EditorSection } from '@/components/domain/SecurityEditor';

// ---------------------------------------------------------------------------
// SortableTab — wraps a watchlist tab with dnd-kit sortable (handle on grip)
// ---------------------------------------------------------------------------

interface SortableTabProps {
  watchlist: Watchlist;
  isActive: boolean;
  sortable: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSwitchTab: () => void;
  onStartRename: () => void;
  onDuplicate: () => void;
  onDelete: (() => void) | null;
}

function SortableTab({
  watchlist,
  isActive,
  sortable,
  isRenaming,
  renameValue,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onSwitchTab,
  onStartRename,
  onDuplicate,
  onDelete,
}: SortableTabProps) {
  const { t } = useTranslation('watchlists');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: watchlist.id, disabled: !sortable });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const tabContent = (
    <>
      <div ref={setNodeRef} style={style} className="group flex items-center shrink-0">
        {sortable && (
          <span
            className={cn(
              'cursor-grab text-muted-foreground transition-opacity duration-150',
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        {isRenaming ? (
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            className="h-8 w-32 text-sm"
          />
        ) : (
          <button
            className={cn(
              'relative px-3 py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              !isActive && 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            onClick={onSwitchTab}
          >
            {isActive && (
              <motion.div
                layoutId="watchlist-tab-indicator"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className={cn('relative z-10', isActive ? 'text-primary-foreground' : '')}>
              {watchlist.name}
            </span>
          </button>
        )}
        {/* Kebab menu -- visible on active, hover-reveal on inactive */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6 shrink-0 ml-0.5 transition-opacity duration-150',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label={t('tabs.rename')}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onStartRename}>
              {t('tabs.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              {t('tabs.duplicate')}
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                  {t('tabs.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Delete confirmation dialog */}
      {onDelete && (
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('tabs.deleteConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('tabs.deleteConfirmMessage', { name: watchlist.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel', { ns: 'common' })}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                {t('tabs.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );

  // Wrap with ContextMenu for right-click support
  if (isRenaming) return tabContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Wrap in a span so ContextMenuTrigger has a single child */}
        <span className="flex items-center">
          {tabContent}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>
          {t('tabs.rename')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>
          {t('tabs.duplicate')}
        </ContextMenuItem>
        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setDeleteConfirmOpen(true)}>
              {t('tabs.delete')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Watchlists page
// ---------------------------------------------------------------------------

export default function Watchlists() {
  const { t } = useTranslation('watchlists');
  const navigate = useNavigate();
  const { data: watchlists, isLoading } = useWatchlists();
  const { mutate: createWatchlist } = useCreateWatchlist();
  const { mutate: updateWatchlist } = useUpdateWatchlist();
  const { mutate: deleteWatchlist } = useDeleteWatchlist();
  const { mutate: duplicateWatchlist } = useDuplicateWatchlist();
  const { mutate: reorderWatchlists } = useReorderWatchlists();
  const { mutate: removeSecurity } = useRemoveWatchlistSecurity();

  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [newWatchlistOpen, setNewWatchlistOpen] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [renamingTabId, setRenamingTabId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addInstrumentDialogOpen, setAddInstrumentDialogOpen] = useState(false);
  const [editSecurityId, setEditSecurityId] = useState<string | null>(null);
  const [editSection, setEditSection] = useState<EditorSection | undefined>(undefined);
  const { mutate: addSecurity } = useAddWatchlistSecurity();

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const sortedWatchlists = useMemo(
    () => [...(watchlists ?? [])].sort((a, b) => a.order - b.order),
    [watchlists],
  );

  // Resolve active watchlist: prefer activeTabId, fallback to first
  const activeWatchlist = useMemo(() => {
    if (sortedWatchlists.length === 0) return null; // native-ok
    if (activeTabId !== null) {
      const found = sortedWatchlists.find((w) => w.id === activeTabId);
      if (found) return found;
    }
    return sortedWatchlists[0]; // native-ok
  }, [sortedWatchlists, activeTabId]);

  // Filtered securities based on search
  const filteredSecurities = useMemo(() => {
    if (!activeWatchlist) return [];
    if (!searchQuery.trim()) return activeWatchlist.securities;
    const q = searchQuery.toLowerCase();
    return activeWatchlist.securities.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.isin && s.isin.toLowerCase().includes(q)) ||
        (s.ticker && s.ticker.toLowerCase().includes(q)),
    );
  }, [activeWatchlist, searchQuery]);

  const canSort = sortedWatchlists.length > 1; // native-ok

  // ---- Tab actions ----

  function switchTab(id: number) {
    setActiveTabId(id);
  }

  function handleCreateWatchlist() {
    const name = newWatchlistName.trim();
    if (!name) return;
    createWatchlist({ name }, {
      onSuccess: (created) => {
        setActiveTabId(created.id);
      },
    });
    setNewWatchlistOpen(false);
    setNewWatchlistName('');
  }

  function handleDuplicateWatchlist(id: number) {
    duplicateWatchlist(id, {
      onSuccess: (created) => {
        setActiveTabId(created.id);
      },
    });
  }

  function handleDeleteWatchlist(id: number) {
    if (sortedWatchlists.length <= 1) return; // native-ok
    deleteWatchlist(id, {
      onSuccess: () => {
        if (activeTabId === id) {
          const remaining = sortedWatchlists.filter((w) => w.id !== id);
          if (remaining.length > 0) setActiveTabId(remaining[0].id); // native-ok
        }
      },
    });
  }

  function commitRename(id: number) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      updateWatchlist({ id, name: trimmed });
    }
    setRenamingTabId(null);
  }

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortedWatchlists.findIndex((w) => w.id === active.id);
    const newIdx = sortedWatchlists.findIndex((w) => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(sortedWatchlists, oldIdx, newIdx);
    reorderWatchlists(reordered.map((w) => w.id));
  }

  function handleRemoveSecurity(securityId: string) {
    if (!activeWatchlist) return;
    removeSecurity({ watchlistId: activeWatchlist.id, securityId });
  }

  function handleCreateNew() {
    setAddDialogOpen(false);
    setAddInstrumentDialogOpen(true);
  }

  function handleInstrumentCreated(securityUuid: string) {
    if (!activeWatchlist) return;
    addSecurity(
      { watchlistId: activeWatchlist.id, securityId: securityUuid },
      { onSuccess: () => setAddInstrumentDialogOpen(false) },
    );
  }

  // ---- Rendering helpers ----

  function renderTabList() {
    if (!activeWatchlist) return null;
    return sortedWatchlists.map((w) => (
      <SortableTab
        key={w.id}
        watchlist={w}
        isActive={w.id === activeWatchlist.id}
        sortable={canSort}
        isRenaming={renamingTabId === w.id}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onCommitRename={() => commitRename(w.id)}
        onCancelRename={() => setRenamingTabId(null)}
        onSwitchTab={() => switchTab(w.id)}
        onStartRename={() => {
          setRenameValue(w.name);
          setRenamingTabId(w.id);
        }}
        onDuplicate={() => handleDuplicateWatchlist(w.id)}
        onDelete={canSort ? () => handleDeleteWatchlist(w.id) : null}
      />
    ));
  }

  function renderTabs() {
    if (!canSort) return renderTabList();
    return (
      <DndContext
        sensors={tabSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleTabDragEnd}
      >
        <SortableContext
          items={sortedWatchlists.map((w) => w.id)}
          strategy={horizontalListSortingStrategy}
        >
          {renderTabList()}
        </SortableContext>
      </DndContext>
    );
  }

  function computeChange(latestPrice: number | null, previousClose: number | null): { value: number; formatted: string } | null {
    if (latestPrice == null || previousClose == null || previousClose === 0) return null; // native-ok
    const change = ((latestPrice - previousClose) / previousClose) * 100; // native-ok
    const sign = change >= 0 ? '+' : ''; // native-ok
    return { value: change, formatted: `${sign}${change.toFixed(2)}%` }; // native-ok
  }

  function renderSecuritiesTable() {
    if (!activeWatchlist) return null;

    if (activeWatchlist.securities.length === 0) { // native-ok
      return (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-4">
          <List className="h-12 w-12 opacity-30" />
          <div className="text-center">
            <p className="text-sm">{t('empty.noSecurities')}</p>
            <p className="text-xs mt-1">{t('empty.addSome')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('actions.addSecurity')}
          </Button>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-3 px-4 font-medium text-muted-foreground">{t('table.name')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">{t('table.ticker')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">{t('table.price')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground text-right">{t('table.change')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">{t('table.currency')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground">{t('table.lastQuote')}</th>
              <th className="py-3 px-4 font-medium text-muted-foreground w-10" />
            </tr>
          </thead>
          <tbody>
            {filteredSecurities.map((sec) => {
              const change = computeChange(sec.latestPrice, sec.previousClose);
              return (
                <tr
                  key={sec.id}
                  className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/investments/${sec.id}`)}
                >
                  {/* Name */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <SecurityAvatar name={sec.name} logoUrl={sec.logoUrl} size="md" rounded="full" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{sec.name}</div>
                        {sec.isin && (
                          <div className="text-xs text-muted-foreground">{sec.isin}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* Ticker */}
                  <td className="py-3 px-4 text-muted-foreground">
                    {sec.ticker ?? '\u2014'}
                  </td>
                  {/* Price */}
                  <td className="py-3 px-4 text-right">
                    {sec.latestPrice != null ? (
                      <CurrencyDisplay value={sec.latestPrice} currency={sec.currency} />
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </td>
                  {/* Change */}
                  <td className="py-3 px-4 text-right">
                    {change ? (
                      <span
                        className={cn(
                          'font-medium',
                          change.value >= 0 ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]', // native-ok
                        )}
                      >
                        {change.formatted}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </td>
                  {/* Currency */}
                  <td className="py-3 px-4 text-muted-foreground">
                    {sec.currency}
                  </td>
                  {/* Last Quote */}
                  <td className="py-3 px-4">
                    {sec.latestPriceDate ? (
                      <span className="text-muted-foreground">{formatDate(sec.latestPriceDate)}</span>
                    ) : (
                      <span className="text-[var(--qv-warning)] text-xs">{t('table.noQuotes')}</span>
                    )}
                  </td>
                  {/* Actions */}
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => {
                          setEditSecurityId(sec.id);
                          setEditSection(undefined);
                        }}>
                          {t('actions.editSecurity')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => navigate(`/investments/${sec.id}`)}>
                          {t('actions.viewDetails')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => handleRemoveSecurity(sec.id)}
                        >
                          {t('actions.removeFromWatchlist')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredSecurities.length === 0 && searchQuery.trim() && ( // native-ok
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            {t('addDialog.noResults')}
          </div>
        )}
      </div>
    );
  }

  // ---- Loading state ----

  if (isLoading) {
    return (
      <div className="qv-page space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => ( // native-ok
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ---- Empty state: no watchlists ----

  if (!sortedWatchlists.length) { // native-ok
    return (
      <div className="qv-page">
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-4">
          <List className="h-12 w-12 opacity-30" />
          <h2 className="text-lg font-medium text-foreground">{t('empty.title')}</h2>
          <p className="text-sm">{t('empty.description')}</p>
          <Button
            onClick={() => {
              createWatchlist({ name: t('tabs.defaultName') }, {
                onSuccess: (created) => setActiveTabId(created.id),
              });
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('empty.createFirst')}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Main page ----

  return (
    <div className="qv-page space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border pb-2 overflow-x-auto">
        {renderTabs()}

        {/* Spacer pushes action buttons to the right */}
        <div className="flex-1" />

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground"
            onClick={() => setNewWatchlistOpen(true)}
            title={t('tabs.new')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Toolbar: search + add security */}
      {activeWatchlist && activeWatchlist.securities.length > 0 && ( // native-ok
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('addDialog.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('actions.addSecurity')}
          </Button>
        </div>
      )}

      {/* Securities table */}
      {renderSecuritiesTable()}

      {/* New watchlist dialog */}
      <Dialog open={newWatchlistOpen} onOpenChange={setNewWatchlistOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('tabs.new')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('empty.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="new-watchlist-name">{t('tabs.new')}</Label>
            <Input
              id="new-watchlist-name"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              placeholder={t('tabs.defaultName')}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateWatchlist(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewWatchlistOpen(false)}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button onClick={handleCreateWatchlist} disabled={!newWatchlistName.trim()}>
              {t('create', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add security to watchlist dialog */}
      {activeWatchlist && (
        <AddSecurityToWatchlistDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          watchlistId={activeWatchlist.id}
          existingSecurityIds={activeWatchlist.securities.map((s) => s.id)}
          onCreateNew={handleCreateNew}
        />
      )}
      {activeWatchlist && (
        <AddInstrumentDialog
          open={addInstrumentDialogOpen}
          onOpenChange={setAddInstrumentDialogOpen}
          onCreated={handleInstrumentCreated}
        />
      )}

      {editSecurityId && (
        <SecurityEditor
          mode="edit"
          securityId={editSecurityId}
          open={!!editSecurityId}
          onOpenChange={(open) => {
            if (!open) {
              setEditSecurityId(null);
              setEditSection(undefined);
            }
          }}
          initialSection={editSection}
        />
      )}
    </div>
  );
}
