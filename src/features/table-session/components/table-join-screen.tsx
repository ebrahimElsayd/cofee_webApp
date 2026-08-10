"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isValidTableId,
  resolveLocalTableSession,
} from "../services/local-table-session.service";
import { TableSessionError } from "../types/table-session";
import styles from "./table-join-screen.module.css";

type JoinStatus = "identifying" | "joining" | "success" | "invalid" | "error";

type TableJoinScreenProps = {
  rawTableId: string;
};

const IDENTIFYING_DURATION_MS = 550;

export function TableJoinScreen({ rawTableId }: TableJoinScreenProps) {
  const router = useRouter();
  const [status, setStatus] = useState<JoinStatus>("identifying");
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const attemptRef = useRef(0);
  const redirectTimerRef = useRef<number | null>(null);

  const joinTable = useCallback(async () => {
    const currentAttempt = ++attemptRef.current;
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    setStatus("identifying");
    setTableNumber(null);

    await new Promise((resolve) => window.setTimeout(resolve, IDENTIFYING_DURATION_MS));

    if (currentAttempt !== attemptRef.current) return;

    if (!isValidTableId(rawTableId)) {
      setStatus("invalid");
      return;
    }

    setTableNumber(Number(rawTableId));
    setStatus("joining");

    try {
      const session = await resolveLocalTableSession(rawTableId);

      if (currentAttempt !== attemptRef.current) return;

      setTableNumber(session.tableId);
      setStatus("success");

      redirectTimerRef.current = window.setTimeout(() => {
        router.replace(`/table/${session.tableId}/menu`);
      }, 850);
    } catch (error) {
      if (currentAttempt !== attemptRef.current) return;

      setStatus(
        error instanceof TableSessionError && error.code === "INVALID_TABLE"
          ? "invalid"
          : "error",
      );
    }
  }, [rawTableId, router]);

  useEffect(() => {
    const startTimer = window.setTimeout(() => {
      void joinTable();
    }, 0);

    return () => {
      window.clearTimeout(startTimer);
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
      attemptRef.current += 1;
    };
  }, [joinTable]);

  const isLoading = status === "identifying" || status === "joining";
  const isFailure = status === "invalid" || status === "error";

  return (
    <main className={styles.page}>
      <div className={styles.topGlow} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      <section className={styles.content} aria-labelledby="join-title">
        <div className={styles.brand}>
          <div className={styles.crownFrame} aria-hidden="true">
            <svg viewBox="0 0 64 64" role="presentation">
              <path d="M10 19 22 31 32 12l10 19 12-12-5 29H15L10 19Z" />
              <path d="M17 53h30" />
            </svg>
          </div>
          <p className={styles.brandArabic}>كافيه الملوك</p>
          <p className={styles.brandEnglish} lang="en">KING&apos;S CAFÉ</p>
        </div>

        <div
          className={styles.statusArea}
          aria-live={isFailure ? "assertive" : "polite"}
          aria-busy={isLoading}
          role={isFailure ? "alert" : "status"}
        >
          <div className={styles.transitionPanel} key={status}>
            {isLoading && <LoadingIndicator />}
            {status === "success" && <SuccessIndicator />}
            {isFailure && <ErrorIndicator />}

            {tableNumber !== null && !isFailure && (
              <div className={styles.tableBadge} lang="en" aria-label={`Table ${tableNumber}`}>
                <span aria-hidden="true" />
                Table {tableNumber}
              </div>
            )}

            <StatusCopy status={status} />

            {isFailure && (
              <button className={styles.retryButton} type="button" onClick={() => void joinTable()}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" />
                </svg>
                إعادة المحاولة
              </button>
            )}
          </div>
        </div>

        <p className={styles.securityNote}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 5 6v5c0 4.5 2.8 8.1 7 10 4.2-1.9 7-5.5 7-10V6l-7-3Z" />
            <path d="m9.5 12 1.7 1.7 3.6-4" />
          </svg>
          اتصال آمن وتجربة طلب بدون تسجيل حساب
        </p>
      </section>
    </main>
  );
}

function LoadingIndicator() {
  return (
    <div className={styles.loader} aria-hidden="true">
      <span />
      <svg viewBox="0 0 64 64">
        <path d="M17 25 25 34l7-16 7 16 8-9-4 22H21l-4-22Z" />
      </svg>
    </div>
  );
}

function SuccessIndicator() {
  return (
    <div className={`${styles.resultIcon} ${styles.successIcon}`} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg>
    </div>
  );
}

function ErrorIndicator() {
  return (
    <div className={`${styles.resultIcon} ${styles.errorIcon}`} aria-hidden="true">!</div>
  );
}

function StatusCopy({ status }: { status: JoinStatus }) {
  const content = {
    identifying: {
      title: "جارٍ التعرّف على الطاولة...",
      support: "Identifying your table",
    },
    joining: {
      title: "جارٍ تجهيز طاولتك...",
      support: "Joining your table",
    },
    success: {
      title: "تم الانضمام إلى الطاولة بنجاح",
      support: "Your table is ready",
    },
    invalid: {
      title: "تعذّر التعرّف على الطاولة",
      support: "امسح رمز QR الموجود على الطاولة مرة أخرى.",
    },
    error: {
      title: "تعذّر الاتصال مؤقتًا",
      support: "تحقق من اتصالك ثم حاول مرة أخرى.",
    },
  }[status];

  return (
    <div className={styles.statusCopy}>
      <h1 id="join-title">{content.title}</h1>
      <p lang={status === "identifying" || status === "joining" || status === "success" ? "en" : "ar"}>
        {content.support}
      </p>
    </div>
  );
}
