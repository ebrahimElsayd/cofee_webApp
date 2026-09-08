"use client";

export default function HomePage() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-[#070806] px-4 py-6 text-[#f7f2e8] sm:px-6 sm:py-8">
      <div className="pointer-events-none absolute -left-32 -top-32 size-80 rounded-full bg-[#e0a020]/[.08] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 size-96 rounded-full bg-emerald-500/[.05] blur-3xl" />

      <section className="relative mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center">
        <header className="mb-7 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl border border-[#e0a020]/45 bg-[#e0a020]/10 text-2xl shadow-[0_0_28px_rgba(224,160,32,.14)]">☕</div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[.28em] text-[#e0a020]">KING&apos;S CAFÉ</p>
            <p className="mt-1 text-xs text-white/45">تجربة طلب سهلة وآمنة</p>
          </div>
        </header>

        <div className="rounded-[2rem] border border-white/10 bg-white/[.035] p-5 text-center shadow-[0_24px_80px_rgba(0,0,0,.35)] backdrop-blur-xl sm:p-7">
          <div className="mx-auto grid size-24 place-items-center rounded-3xl border border-[#e0a020]/35 bg-[#e0a020]/[.08] text-5xl shadow-[0_0_45px_rgba(224,160,32,.16)]">▦</div>
          <p className="mt-7 text-[10px] font-medium uppercase tracking-[.3em] text-[#e0a020]">TABLE ACCESS</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">ادخل إلى قائمة الكافيه</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-white/55">استخدم كاميرا هاتفك لمسح رمز QR الموجود على طاولتك. سيتم فتح القائمة الخاصة بالطاولة تلقائيًا.</p>

          <div className="mt-7 space-y-3 text-right">
            {[["01", "افتح كاميرا الهاتف", "استخدم الكاميرا الأصلية في هاتفك"], ["02", "وجّهها إلى QR الطاولة", "ستجد الرمز مطبوعًا على الطاولة"], ["03", "ابدأ الطلب", "ستفتح قائمة الكافيه تلقائيًا"]].map(([number, title, description]) => (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 p-3.5" key={number}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#e0a020]/35 bg-[#e0a020]/[.08] text-xs font-semibold text-[#e0a020]">{number}</span>
                <div><strong className="block text-sm">{title}</strong><small className="mt-1 block text-xs text-white/40">{description}</small></div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-white/35"><span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_#6ee7b7]" /> لا يلزم تسجيل الدخول</div>
        </div>

        <footer className="mt-5 text-center text-[10px] text-white/25">اتصال آمن · جلسة مستقلة لكل طاولة</footer>
      </section>
    </main>
  );
}
