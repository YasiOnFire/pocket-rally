# Pocket Rally ’04

**By [yasio.dev](https://yasio.dev)**

[Zagraj w przeglądarce](https://yasionfire.github.io/pocket-rally/) · [Kod na GitHubie](https://github.com/YasiOnFire/pocket-rally)

Mini gra rajdowa w Three.js: kanciasta grafika i paleta inspirowana GBA. Wszystkie modele, otoczenie, oznaczenia, minimapa i dźwięki powstają w kodzie. Nie zawiera zewnętrznych assetów ani fontów.

## Uruchomienie

Wymagany Node.js 22.12+.

```sh
npm ci
npm run dev
```

Otwórz adres wypisany przez Vite. `npm run build` tworzy statyczną wersję w `dist/`, a `npm run preview` pozwala ją sprawdzić.

## Sterowanie

| Klawisz | Działanie |
| --- | --- |
| Enter | Start / wznowienie / kolejny przejazd |
| W / ↑ | Gaz |
| S / ↓ | Hamulec, następnie wsteczny |
| A / D lub ← / → | Skręcanie |
| Spacja | Hamulec ręczny |
| R | Powrót na trasę, kara +5 s |
| Esc | Pauza |
| C | Kamera pościgowa / wysoka |
| M | Wyciszenie wszystkich dźwięków |
| N | Włączanie / wyłączanie samej muzyki 8-bit |

## Odcinki

W menu są dwa osobne oesy, każdy z trzema sektorami i własnym rekordem:

- **Sosnowa Przełęcz — 2,685 km:** asfalt, luźny szuter i ziemia. Szuter mocniej zarzuca tyłem i wymaga kontrowania.
- **Biała Grań — 2,389 km:** inny przebieg trasy, osiem odcinków śniegu, lodu i asfaltu. Śnieg ma mniejszą przyczepność, a lód najmniejszą oraz wyraźnie wydłużoną drogę hamowania.

Pobocze i zaspy spowalniają, drzewa i głazy mają kolizje. Podczas poślizgu obie tylne opony zostawiają ślady odpowiednie dla nawierzchni. Ślady mają ograniczony bufor geometrii i czyszczą się przy restarcie lub zmianie oesu; powrót auta na drogę nie łączy ich przez mapę.

Minimapę, czas, prędkość, bieg i komunikaty o zakrętach widać podczas jazdy. Rekordy, wybór oesu i ustawienie muzyki zapisują się lokalnie w przeglądarce. Z pauzy lub wyniku można wrócić do wyboru odcinka. Zmiana aktywnego okna zatrzymuje przejazd.

Komunikaty pilota są wizualne. Silnik, tarcie opon, nawierzchnie, sygnały i delikatną autorską muzykę 8-bit generuje Web Audio. Zima ma spokojniejszą aranżację. Muzykę można wyłączyć osobno, zachowując odgłosy jazdy. Potrzebna jest przeglądarka z WebGL 2 i klawiatura.

## Sprawdzanie

```sh
npm test
npm run build
```

Testy obejmują czas, gaz, hamulec, kierunki z perspektywy kamery na pięciu nawierzchniach, pauzę, powrót na trasę, mocniejszy uślizg szutru, hamowanie na lodzie, oba pełne symulowane przejazdy, geometrię śladów i działanie syntezatora. Test przejazdu sprawdza model fizyki i trasę; weryfikacja renderowania i interakcji klawiatury odbywa się osobno w przeglądarce.

Na serwerze deweloperskim `/scripts/audio-check.html` pozwala wyrenderować obie aranżacje przez prawdziwy `OfflineAudioContext` i sprawdzić próbki oraz poziom sygnału bez odtwarzania dźwięku. To test techniczny, nie odsłuch. Strona testowa nie wchodzi do produkcyjnego buildu.

## Kod

- `src/main.js`: renderowanie, kamera, klawiatura, HUD, rekord.
- `src/physics.js`: deterministyczna symulacja 60 Hz i stan przejazdu.
- `src/track.js`: geometria i nawierzchnie oesów, komunikaty pilota.
- `src/world.js`: modele, krajobraz, przeszkody i cząsteczki.
- `src/skidmarks.js`: ograniczony bufor śladów opon.
- `src/audio.js`: synteza odgłosów i muzyki.

To lekki prototyp o zręcznościowym modelu jazdy, z jednym samochodem i dwoma oesami.

## GitHub Pages

Workflow `.github/workflows/pages.yml` po każdym pushu do `main` uruchamia testy, buduje grę i publikuje `dist/` w GitHub Pages. W ustawieniach repozytorium: **Settings → Pages → Source → GitHub Actions**.

Gra działa w całości w przeglądarce i nie wymaga kluczy API, konta ani zewnętrznego backendu. Względne ścieżki buildu pozwalają uruchomić ją również w podkatalogu repozytorium.
