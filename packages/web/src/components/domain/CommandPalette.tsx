import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  TrendingUp,
  ArrowLeftRight,
  Landmark,
  List,
  BarChart3,
  LineChart,
  DollarSign,
  PieChart,
  Layers,
  Settings,
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

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type NavEntry = { to: string; labelKey: string; icon: React.ElementType };
type NavSection = { sectionKey: string; items: NavEntry[] };

const NAV_SECTIONS: NavSection[] = [
  {
    sectionKey: 'sections.main',
    items: [
      { to: '/', labelKey: 'items.dashboard', icon: LayoutDashboard },
    ],
  },
  {
    sectionKey: 'sections.data',
    items: [
      { to: '/investments', labelKey: 'items.investments', icon: TrendingUp },
      { to: '/transactions', labelKey: 'items.transactions', icon: ArrowLeftRight },
      { to: '/accounts', labelKey: 'items.accounts', icon: Landmark },
      { to: '/watchlists', labelKey: 'items.watchlists', icon: List },
    ],
  },
  {
    sectionKey: 'sections.analysis',
    items: [
      { to: '/analytics/calculation', labelKey: 'items.analytics', icon: BarChart3 },
      { to: '/analytics/chart', labelKey: 'cmdPalette.perfChart', icon: LineChart },
      { to: '/analytics/income', labelKey: 'cmdPalette.income', icon: DollarSign },
    ],
  },
  {
    sectionKey: 'sections.taxonomies',
    items: [
      { to: '/allocation', labelKey: 'items.assetAllocation', icon: PieChart },
      { to: '/taxonomies/data-series', labelKey: 'items.dataSeries', icon: Layers },
    ],
  },
  {
    sectionKey: 'sections.system',
    items: [
      { to: '/settings', labelKey: 'items.settings', icon: Settings },
    ],
  },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation('navigation');
  const navigate = useNavigate();
  const location = useLocation();

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
        {NAV_SECTIONS.map((section) => (
          <CommandGroup key={section.sectionKey} heading={t(section.sectionKey)}>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.to}
                  value={t(item.labelKey)}
                  onSelect={() => handleSelect(item.to)}
                >
                  <Icon />
                  {t(item.labelKey)}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
