import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  DollarSign,
} from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { isPeriodSensitivePath, extractPeriodSearch } from '@/lib/period-utils';
import { NAV_SUFFIXES, scopePath } from '@/lib/nav-suffixes';
import { usePortfolio } from '@/context/PortfolioContext';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Analytics-flavored deep links beyond the sidebar tree. Shape mirrors NavItem.
const ANALYTICS_DEEP_LINKS = [
  { suffix: 'analytics/chart', labelKey: 'cmdPalette.perfChart', icon: LineChart },
  { suffix: 'analytics/income', labelKey: 'cmdPalette.income', icon: DollarSign },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation('navigation');
  const navigate = useNavigate();
  const location = useLocation();
  const portfolio = usePortfolio();

  function handleSelect(to: string) {
    onOpenChange(false);
    const periodSearch = isPeriodSensitivePath(to) ? extractPeriodSearch(location.search) : '';
    if (periodSearch) {
      navigate({ pathname: to, search: periodSearch });
    } else {
      navigate(to);
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('cmdPalette.title')}
      description={t('cmdPalette.description')}
      showCloseButton={false}
    >
      <CommandInput placeholder={t('cmdPalette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('cmdPalette.noResults')}</CommandEmpty>
        {NAV_SUFFIXES.map((section) => (
          <CommandGroup key={section.sectionKey} heading={t(section.sectionKey)}>
            {section.items.map((item) => {
              const Icon = item.icon;
              const to = scopePath(portfolio.id, item.to);
              return (
                <CommandItem
                  key={to}
                  value={t(item.labelKey)}
                  onSelect={() => handleSelect(to)}
                >
                  <Icon />
                  {t(item.labelKey)}
                </CommandItem>
              );
            })}
            {section.sectionKey === 'sections.analysis' && (
              <>
                {ANALYTICS_DEEP_LINKS.map((entry) => {
                  const Icon = entry.icon;
                  const to = scopePath(portfolio.id, entry.suffix);
                  return (
                    <CommandItem
                      key={to}
                      value={t(entry.labelKey)}
                      onSelect={() => handleSelect(to)}
                    >
                      <Icon />
                      {t(entry.labelKey)}
                    </CommandItem>
                  );
                })}
              </>
            )}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
