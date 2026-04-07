import { Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { DesktopSidebar, CollapsedSidebar, MobileNav, SidebarDrawer } from './Sidebar';
import { TopBar } from './TopBar';
import { usePortfolio } from '@/api/use-portfolio';

export function Shell() {
  const { data: portfolio, isSuccess, error } = usePortfolio();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const shouldRedirect = (isSuccess && portfolio?.empty) ||
    !!(error && (error as Error).message === 'SETUP_REQUIRED');

  useEffect(() => {
    if (shouldRedirect) {
      navigate('/import', { replace: true });
    }
  }, [shouldRedirect, navigate]);

  // Ctrl+B toggles sidebar drawer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setDrawerOpen((prev) => !prev);
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

  if (shouldRedirect) {
    return null;
  }

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
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
