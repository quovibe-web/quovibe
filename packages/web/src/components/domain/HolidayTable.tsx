import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { getHolidaysForYear } from '@quovibe/shared';

interface Props {
  calendarId: string;
  year: number;
}

export function HolidayTable({ calendarId, year }: Props) {
  const { t } = useTranslation('settings');
  const holidays = getHolidaysForYear(calendarId, year);

  if (holidays.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('holidays.noHolidays')}</p>;
  }

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b">
          <th className="py-1 pr-4 font-medium">{t('holidays.columns.date')}</th>
          <th className="py-1 pr-4 font-medium">{t('holidays.columns.day')}</th>
          <th className="py-1 font-medium">{t('holidays.columns.holiday')}</th>
        </tr>
      </thead>
      <tbody>
        {holidays.map((h) => {
          const d = new Date(h.date + 'T12:00:00');
          const dayName = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }).format(d);
          const dateDisplay = d.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' });
          return (
            <tr key={h.date} className="border-b border-border/40">
              <td className="py-1 pr-4 font-mono">{dateDisplay}</td>
              <td className="py-1 pr-4 text-muted-foreground">{dayName}</td>
              <td className="py-1">{h.name}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
