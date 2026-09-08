import type { CustomizationGroup as CustomizationGroupType } from "../../types/menu";
import styles from "../product-details-screen.module.css";

type CustomizationGroupProps = {
  group: CustomizationGroupType;
  selectedOptionId?: string;
  highlightSelection?: boolean;
  onChange: (optionId: string) => void;
};

export function CustomizationGroup({
  group,
  selectedOptionId,
  highlightSelection = true,
  onChange,
}: CustomizationGroupProps) {
  const availableOptions = group.options.filter((option) => option.available);

  return (
    <section className={styles.optionSection}>
      <div className={styles.optionHeading}>
        <div>
          <h2 lang="en">{group.label}</h2>
          <p>{group.labelAr}</p>
        </div>
        <span>{group.required ? "مطلوب" : "اختياري"}</span>
      </div>

      {availableOptions.length === 0 ? (
        <div className={styles.groupUnavailable}>
          <span aria-hidden="true">!</span>
          <div><strong>غير متاح حاليًا</strong><small>لا توجد اختيارات متاحة في هذه المجموعة.</small></div>
        </div>
      ) : group.display === "curve" ? (
        <CurveOptions group={group} selectedOptionId={selectedOptionId} highlightSelection={highlightSelection} onChange={onChange} />
      ) : (
        <ChoiceOptions group={group} selectedOptionId={selectedOptionId} highlightSelection={highlightSelection} onChange={onChange} />
      )}
    </section>
  );
}

function ChoiceOptions({ group, selectedOptionId, highlightSelection = true, onChange }: CustomizationGroupProps) {
  const className = group.display === "cards" ? styles.dynamicCards : styles.segmentedOptions;

  return (
    <div className={className} style={{ "--option-count": group.options.length } as React.CSSProperties}>
      {group.options.map((option) => {
        const selected = selectedOptionId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={highlightSelection && selected ? styles.selectedOption : undefined}
            aria-pressed={selected}
            disabled={!option.available}
            onClick={() => onChange(option.id)}
          >
            <span lang="en">{option.label}{option.price > 0 && <b> +{option.price}</b>}</span>
            <small>{option.labelAr}</small>
            {!option.available && <em>غير متاح</em>}
          </button>
        );
      })}
    </div>
  );
}

function CurveOptions({ group, selectedOptionId, highlightSelection = true, onChange }: CustomizationGroupProps) {
  const selectedIndex = highlightSelection ? Math.max(0, group.options.findIndex((option) => option.id === selectedOptionId)) : 0;
  const progress = group.options.length > 1 ? (selectedIndex / (group.options.length - 1)) * 100 : 100;

  return (
    <div className={styles.sugarCurve} role="group" aria-label={group.labelAr}>
      <svg viewBox="0 0 300 92" preserveAspectRatio="none" aria-hidden="true">
        <path className={styles.sugarTrack} d="M18 72 C82 7 218 7 282 72" pathLength="100" />
        <path className={styles.sugarProgress} d="M18 72 C82 7 218 7 282 72" pathLength="100" style={{ strokeDasharray: `${progress} 100` }} />
      </svg>
      <div className={styles.sugarPoints} style={{ "--curve-count": group.options.length } as React.CSSProperties}>
        {group.options.map((option, index) => {
          const selected = selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={highlightSelection && selected ? styles.activeSugarPoint : undefined}
              aria-pressed={selected}
              disabled={!option.available}
              aria-label={`${group.labelAr}: ${option.labelAr}`}
              onClick={() => onChange(option.id)}
              data-curve-index={index}
            >
              <i aria-hidden="true" /><span>{option.labelAr}</span>
            </button>
          );
        })}
      </div>
      <output aria-live="polite">
        {group.options.find((option) => option.id === selectedOptionId)?.labelAr ?? "اختر"}
        <small>الاختيار الحالي</small>
      </output>
    </div>
  );
}
