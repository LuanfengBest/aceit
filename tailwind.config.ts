import type { Config } from "tailwindcss";

// 中文字重靠系统字体兜底：Inter / Instrument Serif 都不含 CJK
const CJK_SANS = ['"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"'];
const CJK_SERIF = ['"Songti SC"', '"Noto Serif SC"', '"Source Han Serif SC"'];

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 规范色板，直接按名字用：bg-surface-2 / text-ink / bg-accent-soft
        bg: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        border: "var(--border)",
        ink: "var(--ink)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          foreground: "var(--surface)",
        },
        danger: "var(--danger)",

        // 马卡龙功能色：同一页面按语义并用
        peach: { DEFAULT: "var(--peach)", ink: "var(--peach-ink)" },
        mint: { DEFAULT: "var(--mint)", ink: "var(--mint-ink)" },
        lavender: { DEFAULT: "var(--lavender)", ink: "var(--lavender-ink)" },
        lemon: { DEFAULT: "var(--lemon)", ink: "var(--lemon-ink)" },

        // shadcn 语义 token，保证以后 add 进来的组件能直接跑
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        input: "var(--input)",
        ring: "var(--ring)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...CJK_SANS, "system-ui", "sans-serif"],
        serif: ["var(--font-instrument-serif)", ...CJK_SERIF, "serif"],
        mono: ['var(--font-mono)', "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // 规范里的五档，不要再用 text-sm / text-2xl 之类的默认档
        meta: ["13px", { lineHeight: "1.6" }],
        body: ["14px", { lineHeight: "1.6" }],
        section: ["16px", { lineHeight: "1.4" }],
        // 工作台页标题用这个（Inter 600-700），不用衬线
        head: ["22px", { lineHeight: "1.3", fontWeight: "650" }],
        title: ["28px", { lineHeight: "1.2" }],
        display: ["44px", { lineHeight: "1.15" }],
      },
      borderRadius: {
        lg: "var(--radius)", // 卡片 8px
        md: "calc(var(--radius) - 2px)", // 按钮 / 输入框 6px
        sm: "calc(var(--radius) - 4px)",
        pill: "9999px",
      },
      maxWidth: {
        work: "1200px", // 工作台页
        moment: "720px", // 时刻页
      },
      height: {
        row: "44px", // 列表行高
      },
      transitionDuration: {
        DEFAULT: "180ms",
      },
      keyframes: {
        // 只给时刻页用：工作台页不要装饰性动画
        rise: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // 时刻页的装饰云缓慢浮动
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(2%, -3%, 0) scale(1.06)" },
        },
        riseSlow: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // 纸飞机沿弧线缓缓上升
        glide: {
          "0%": { transform: "translate3d(0,0,0) rotate(-8deg)" },
          "50%": { transform: "translate3d(14px,-18px,0) rotate(-2deg)" },
          "100%": { transform: "translate3d(0,0,0) rotate(-8deg)" },
        },
        // 渐变文字缓慢流动
        // 景深：滚动时远近层位移不同，制造纵深
        depthBack: { from: { transform: "translateY(0) scale(1.12)", filter: "blur(14px)" }, to: { transform: "translateY(-4%) scale(1.24)", filter: "blur(22px)" } },
        depthMid: { from: { transform: "translateY(6%) scale(0.98)", filter: "blur(3px)" }, to: { transform: "translateY(-18%) scale(1.04)", filter: "blur(0px)" } },
        depthFront: { from: { transform: "translateY(14%) scale(1)" }, to: { transform: "translateY(-36%) scale(1.1)" } },
        fadeUp: { from: { opacity: "0", transform: "translateY(28px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        shimmer: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        rise: "rise 180ms cubic-bezier(0, 0, 0.2, 1) both",
        "rise-slow": "riseSlow 600ms cubic-bezier(0, 0, 0.2, 1) both",
        drift: "drift 18s ease-in-out infinite",
        glide: "glide 7s ease-in-out infinite",
        shimmer: "shimmer 9s ease-in-out infinite",
        "depth-back": "depthBack linear both",
        "depth-mid": "depthMid linear both",
        "depth-front": "depthFront linear both",
        "fade-up": "fadeUp 700ms cubic-bezier(0,0,0.2,1) both",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0, 0, 0.2, 1)", // ease-out
      },
    },
  },
  plugins: [],
};

export default config;
