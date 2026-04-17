/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#146ef5',
        'brand-hover': '#0055d4',
        'brand-light': '#3b89ff',
        'near-black': '#080808',
        'mid-gray': '#5a5a5a',
        border: '#d8d8d8',
        'border-hover': '#898989',
        accent: {
          purple: '#7a3dff',
          pink: '#ed52cb',
          green: '#00d722',
          orange: '#ff6b00',
          yellow: '#ffae13',
          red: '#ee1d36',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '8px',
      },
      boxShadow: {
        card: '0px 3px 7px rgba(0,0,0,0.09), 0px 13px 13px rgba(0,0,0,0.08), 0px 30px 18px rgba(0,0,0,0.04)',
        panel: '0px 13px 13px rgba(0,0,0,0.08), 0px 30px 18px rgba(0,0,0,0.04), 0px 54px 22px rgba(0,0,0,0.01)',
      },
    },
  },
  plugins: [],
}
