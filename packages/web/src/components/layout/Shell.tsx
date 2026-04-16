import { Outlet } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { DesktopSidebar, CollapsedSidebar, MobileNav, SidebarDrawer } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/components/domain/CommandPalette';

interface ShellProps {
  children?: ReactNode;
}

export function Shell({ children }: ShellProps = {}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  // Ctrl+B toggles sidebar drawer; Ctrl+K / Cmd+K toggles command palette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const mainRef = useRef<HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = useCallback(() => {
    if (mainRef.current) {
      setIsScrolled(mainRef.current.scrollTop > 0);
    }
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DesktopSidebar />
      <CollapsedSidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar onMenuClick={() => setDrawerOpen(true)} isScrolled={isScrolled} />
        <main
          ref={mainRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto scroll-smooth [scrollbar-gutter:stable] px-4 py-5 pb-24 md:px-6 md:pb-6 lg:px-8 lg:py-6"
        >
          {children ?? <Outlet />}
        </main>
      </div>
      <MobileNav />
      <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <CommandPalette open={cmdPaletteOpen} onOpenChange={setCmdPaletteOpen} />
    </div>
  );
}
