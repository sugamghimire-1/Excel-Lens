/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        frame: token('frame'),
        chrome: token('chrome'),
        panel: token('panel'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        accent: token('accent'),
        'accent-ink': token('accent-ink'),
        'accent-soft': token('accent-soft'),
        hover: token('hover'),
        pressed: token('pressed'),
        good: token('good'),
        warn: token('warn'),
        bad: token('bad'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Variable"', '"IBM Plex Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10.5px', '14px'],
        xs: ['11.5px', '16px'],
        sm: ['12.5px', '18px'],
        base: ['13.5px', '20px'],
        lg: ['16px', '22px'],
        xl: ['20px', '26px'],
        '2xl': ['26px', '32px'],
      },
      boxShadow: {
        pop: '0 0 0 1px rgb(var(--shadow) / 0.07), 0 4px 10px -2px rgb(var(--shadow) / 0.10), 0 16px 36px -8px rgb(var(--shadow) / 0.20)',
        card: '0 0 0 1px rgb(var(--shadow) / 0.06), 0 1px 3px rgb(var(--shadow) / 0.10)',
        ribbon: '0 1px 0 rgb(var(--line)), 0 3px 8px -4px rgb(var(--shadow) / 0.10)',
      },
      keyframes: {
        pop: { from: { opacity: '0', transform: 'translateY(-4px) scale(0.985)' }, to: { opacity: '1', transform: 'none' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
        slide: { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        pop: 'pop 110ms ease-out',
        fade: 'fade 130ms ease-out',
        rise: 'rise 170ms ease-out',
        slide: 'slide 150ms ease-out',
      },
    },
  },
  plugins: [],
};