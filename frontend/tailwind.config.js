/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // SAP-style white theme (requested)
        shell: '#f5f7fa',
        panel: '#ffffff',
        glass: 'rgba(255, 255, 255, 0.72)',
        border: '#e5e7eb',
        primary: '#2563eb',
        secondary: '#E57373',
        navy: '#0f172a',
      },
      borderRadius: {
        xl2: '18px',
      },
      boxShadow: {
        soft: '0 12px 28px rgba(15, 23, 42, 0.10)',
        glow: '0 0 0 4px rgba(37, 99, 235, 0.16)',
      },
      backdropBlur: {
        glass: '14px',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.35)', opacity: '0.55' },
        },
        flow: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
      },
      animation: {
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite',
        flow: 'flow 1.4s linear infinite',
      },
    },
  },
  plugins: [],
}
