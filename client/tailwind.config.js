/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eaf2ff',
          500: '#3b82f6',
          600: '#1d6fe8',
          700: '#1558bd',
        },
        page: '#eef1f6',
        ink: '#1e293b',
        muted: '#5b6b80',
        line: '#e1e6ee',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};