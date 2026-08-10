"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addToLocalDraftCart,
  addToSharedDraftCart,
  getLocalDraftCart,
  getSharedDraftCart,
} from "@/features/cart/services/local-draft-cart.service";
import {
  addLocalRecipientName,
  getLocalRecipientNames,
} from "@/features/table-session/services/local-recipient-names.service";
import { CustomizationGroup } from "./customization/customization-group";
import {
  calculateCustomizationsPrice,
  createDefaultSelections,
  findMissingRequiredGroup,
  getSelectedCustomizations,
} from "../utils/customization";
import type { MenuProduct } from "../types/menu";
import styles from "./product-details-screen.module.css";

type ProductDetailsScreenProps = {
  product: MenuProduct;
  tableId: number;
};

export function ProductDetailsScreen({ product, tableId }: ProductDetailsScreenProps) {
  const [recipientDraft, setRecipientDraft] = useState("");
  const [recipientNames, setRecipientNames] = useState<string[]>([]);
  const [isRecipientSheetOpen, setIsRecipientSheetOpen] = useState(false);
  const [recipientSheetError, setRecipientSheetError] = useState("");
  const [selections, setSelections] = useState(() =>
    createDefaultSelections(product.customizationGroups),
  );
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [customizationMessage, setCustomizationMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const customizationsPrice = calculateCustomizationsPrice(
    product.customizationGroups,
    selections,
  );
  const unitPrice = product.price + customizationsPrice;
  const totalPrice = useMemo(() => unitPrice * quantity, [quantity, unitPrice]);

  function selectCustomization(groupId: string, optionId: string, required: boolean) {
    setSelections((current) => {
      if (!required && current[groupId] === optionId) {
        const nextSelections = { ...current };
        delete nextSelections[groupId];
        return nextSelections;
      }

      return { ...current, [groupId]: optionId };
    });
    setCustomizationMessage("");
  }

  function openRecipientSheet() {
    setRecipientNames(getLocalRecipientNames(tableId));
    setRecipientDraft("");
    setRecipientSheetError("");
    setIsRecipientSheetOpen(true);
  }

  function chooseRecipient(name: string) {
    const cleanRecipientName = name.trim().replace(/\s+/g, " ");

    if (!cleanRecipientName) return;

    setIsRecipientSheetOpen(false);
    void saveProductToCart(cleanRecipientName);
  }

  function addRecipient() {
    const name = recipientDraft.trim();

    if (!name) {
      setRecipientSheetError("اكتب الاسم أولًا");
      return;
    }

    const updatedNames = addLocalRecipientName(tableId, name);
    setRecipientNames(updatedNames);
    chooseRecipient(name);
  }

  function requestAddProduct() {
    const missingGroup = findMissingRequiredGroup(
      product.customizationGroups,
      selections,
    );

    if (missingGroup) {
      setCustomizationMessage(`اختر ${missingGroup.labelAr} أولًا`);
      document.getElementById(`customization-${missingGroup.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    openRecipientSheet();
  }

  async function saveProductToCart(cleanRecipientName: string) {
    setIsSaving(true);
    const selectedOptions = getSelectedCustomizations(
      product.customizationGroups,
      selections,
    );

    try {
      const item = {
        tableId,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        productNameAr: product.nameAr,
        productImageUrl: product.imageUrl,
        recipientName: cleanRecipientName,
        selectedOptions,
        notes: notes.trim(),
        quantity,
        basePrice: product.price,
        customizationsPrice,
        unitPrice,
        totalPrice,
      };
      const existingLocalItems = getLocalDraftCart(tableId);
      const existingSharedItems = await getSharedDraftCart(tableId);
      if (existingSharedItems.length === 0) {
        for (const existingItem of existingLocalItems) {
          await addToSharedDraftCart(existingItem);
        }
      }
      const sharedItem = await addToSharedDraftCart(item);
      addToLocalDraftCart({ ...item, productImageUrl: sharedItem.productImageUrl });

      window.sessionStorage.setItem(
        "kings-cafe:last-added-product",
        JSON.stringify({ productName: product.name, productNameAr: product.nameAr }),
      );
      const menuUrl = new URL(`/table/${tableId}/menu`, window.location.origin);
      window.location.assign(menuUrl.toString());
    } catch {
      setIsSaving(false);
      setCustomizationMessage("تعذّرت إضافة المنتج. حاول مرة أخرى.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <Image
            src={product.imageUrl}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 520px) 100vw, 480px"
            priority
            unoptimized
          />
          <div className={styles.heroOverlay} aria-hidden="true" />

          <Link className={styles.backButton} href={`/table/${tableId}/menu`} aria-label="العودة إلى القائمة">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </Link>

          <span className={styles.orderBadge}>
            {product.customizationGroups.length > 0 ? "خصّص طلبك" : "تفاصيل المنتج"}
          </span>

          <div className={styles.productTitle}>
            <div>
              <h1 lang="en">{product.name}</h1>
              <p>{product.nameAr}</p>
            </div>
            <strong>{product.price}<small lang="en"> EGP</small></strong>
          </div>
        </section>

        <div className={styles.form}>
          <p className={styles.description} lang="en">{product.description}</p>

          {product.customizationGroups.length > 0 ? (
            product.customizationGroups.map((group, index) => (
              <div
                id={`customization-${group.id}`}
                key={group.id}
                className={styles.customizationBlock}
                style={{ "--group-index": index } as React.CSSProperties}
              >
                <CustomizationGroup
                  group={group}
                  selectedOptionId={selections[group.id]}
                  onChange={(optionId) =>
                    selectCustomization(group.id, optionId, group.required)
                  }
                />
              </div>
            ))
          ) : (
            <section className={styles.readyAsServed}>
              <span aria-hidden="true">✓</span>
              <div>
                <h2 lang="en">Ready as served</h2>
                <p>هذا المنتج جاهز كما هو ولا يحتاج إلى تخصيصات.</p>
              </div>
            </section>
          )}

          {customizationMessage && (
            <p className={styles.customizationMessage} role="alert">
              {customizationMessage}
            </p>
          )}

          {product.allowsNotes && (
            <section className={styles.notesSection}>
              <button type="button" onClick={() => setShowNotes((value) => !value)} aria-expanded={showNotes}>
                <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4V5Z" /></svg> Add Notes</span>
                <small>أضف ملاحظات</small>
                <b aria-hidden="true">{showNotes ? "−" : "+"}</b>
              </button>
              {showNotes && <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={160} placeholder="مثال: بدون قرفة..." rows={3} />}
            </section>
          )}

          <section className={styles.quantitySection} aria-label="الكمية">
            <div><strong lang="en">Quantity</strong><span>الكمية</span></div>
            <div className={styles.quantityControl}>
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity === 1} aria-label="تقليل الكمية">−</button>
              <output aria-live="polite">{quantity}</output>
              <button type="button" onClick={() => setQuantity((value) => Math.min(10, value + 1))} disabled={quantity === 10} aria-label="زيادة الكمية">+</button>
            </div>
          </section>
        </div>

        <footer className={styles.actionBar}>
          <button type="button" onClick={requestAddProduct} disabled={isSaving}>
            <span><strong lang="en">Add to Table Cart</strong><small>أضف إلى طلب الطاولة</small></span>
            <b>{totalPrice} <small lang="en">EGP</small></b>
          </button>
        </footer>

        {isRecipientSheetOpen && (
          <div className={styles.sheetBackdrop} role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsRecipientSheetOpen(false);
          }}>
            <section className={styles.recipientSheet} role="dialog" aria-modal="true" aria-labelledby="recipient-sheet-title">
              <div className={styles.sheetHandle} aria-hidden="true" />
              <header>
                <div><p>خطوة أخيرة قبل الإضافة</p><h2 id="recipient-sheet-title">الطلب ده لمين؟</h2></div>
                <button type="button" onClick={() => setIsRecipientSheetOpen(false)} aria-label="إغلاق">×</button>
              </header>

              {recipientNames.length > 0 && (
                <div className={styles.savedNames}>
                  <p>اختر اسمًا لإتمام الإضافة</p>
                  <div>{recipientNames.map((name) => (
                    <button key={name} type="button" onClick={() => chooseRecipient(name)}>
                      <span>{name.charAt(0).toUpperCase()}</span><b>{name}</b>
                    </button>
                  ))}</div>
                </div>
              )}

              <div className={styles.addNameArea}>
                <label htmlFor="new-recipient-name">إضافة اسم جديد</label>
                <div>
                  <input
                    id="new-recipient-name"
                    value={recipientDraft}
                    onChange={(event) => { setRecipientDraft(event.target.value); setRecipientSheetError(""); }}
                    onKeyDown={(event) => { if (event.key === "Enter") addRecipient(); }}
                    placeholder="اكتب الاسم هنا..."
                    maxLength={30}
                    autoComplete="off"
                    autoFocus
                  />
                  <button type="button" onClick={addRecipient}><span aria-hidden="true">+</span> تأكيد</button>
                </div>
                {recipientSheetError && <p role="alert">{recipientSheetError}</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
