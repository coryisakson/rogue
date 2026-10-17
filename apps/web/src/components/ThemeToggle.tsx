// Colour theme switch (Auto/Light/Dark) for the footer, after the shadcn "Dark mode: Astro" guide: a DropdownMenu that
// toggles the .dark class on <html>. The choice lives in localStorage only (no cookie, no server), so the control needs
// JavaScript and renders nothing on the server. Base.astro applies the stored choice before the first paint and
// follows the system setting while the choice is Auto.
import { useEffect, useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Choice = 'auto' | 'light' | 'dark';
const KEY = 'rogue-theme'; // same key as the pre-paint script in Base.astro

interface Props { labels: Record<Choice | 'label', string> }

function storedChoice(): Choice {
  try {
    const c = localStorage.getItem(KEY);
    return c === 'light' || c === 'dark' ? c : 'auto';
  } catch {
    return 'auto';
  }
}

function applyChoice(choice: Choice) {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {}
  const dark = choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export default function ThemeToggle({ labels }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => setChoice(storedChoice()), []);
  if (!choice) return null;

  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : SunMoon;
  function choose(value: string) {
    const next = value as Choice;
    setChoice(next);
    applyChoice(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="theme-switch">
          <Icon aria-hidden="true" />
          {labels.label}: {labels[choice]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{labels.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={choose}>
          <DropdownMenuRadioItem value="auto">{labels.auto}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">{labels.light}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{labels.dark}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
