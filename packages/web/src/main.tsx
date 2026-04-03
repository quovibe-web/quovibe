import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query-client';
import { router } from '@/router';
import { ThemeProvider } from '@/hooks/use-theme';
import { PrivacyProvider } from '@/context/privacy-context';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidecarSync } from '@/components/shared/SidecarSync';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PrivacyProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <SidecarSync />
            <RouterProvider router={router} />
            <Toaster position="bottom-right" richColors />
          </TooltipProvider>
        </QueryClientProvider>
      </PrivacyProvider>
    </ThemeProvider>
  </React.StrictMode>
);
