import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/use-language';
import { useUpdatePreferences } from '@/api/use-preferences';

export function LanguageSwitcher() {
  const { language, setLanguage, availableLanguages } = useLanguage();
  const { mutate: updatePreferences } = useUpdatePreferences();
  const current = availableLanguages.find((l) => l.code === language) ?? availableLanguages[0];

  function handleLanguageChange(code: string) {
    setLanguage(code as typeof language);
    updatePreferences({ language: code });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={current.label} aria-label={current.label}>
          <span className="text-base">{current.flag}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={language} onValueChange={handleLanguageChange}>
          {availableLanguages.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code}>
              <span className="mr-2">{lang.flag}</span>
              {lang.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
