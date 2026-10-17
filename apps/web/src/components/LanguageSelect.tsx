// Language switcher island (footer, and top-right on bare pages). It always posts the same form to /account/language,
// so the server keeps the profile > cookie > browser logic. Without JavaScript (and before hydration) it renders the
// plain <select> + Change button; once React runs it swaps in the shadcn Select, which submits as soon as you pick.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  id: string;
  locale: string;
  next: string;
  label: string;
  changeLabel: string;
  languages: { value: string; name: string }[];
}

export default function LanguageSelect({ id, locale, next, label, changeLabel, languages }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState(locale);
  useEffect(() => setReady(true), []);

  function choose(lang: string) {
    if (lang === value) return;
    flushSync(() => setValue(lang)); // the hidden input must hold the new value before the form is sent
    form.current?.requestSubmit();
  }

  return (
    <form ref={form} method="post" action="/account/language" className="lang-switch">
      <input type="hidden" name="next" value={next} />
      <label htmlFor={id}>{label}</label>
      {ready ? (
        <>
          <input type="hidden" name="lang" value={value} />
          <Select value={value} onValueChange={choose}>
            <SelectTrigger id={id} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((l) => (
                <SelectItem key={l.value} value={l.value} lang={l.value}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : (
        <>
          <select id={id} name="lang" defaultValue={locale}>
            {languages.map((l) => <option key={l.value} value={l.value} lang={l.value}>{l.name}</option>)}
          </select>
          <button type="submit">{changeLabel}</button>
        </>
      )}
    </form>
  );
}
