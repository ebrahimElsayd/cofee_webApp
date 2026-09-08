-- Persist modifier-group context so identical option labels remain unambiguous
-- in cashier, customer, and receipt views. Existing option fields are kept.
create or replace function public.enrich_order_item_modifier_labels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option jsonb;
  v_options jsonb := '[]'::jsonb;
  v_meta record;
begin
  if jsonb_typeof(new.selected_options) <> 'array' then
    return new;
  end if;

  for v_option in select value from jsonb_array_elements(new.selected_options)
  loop
    v_meta := null;
    begin
      select mo.id as option_id,
             mo.name as option_label,
             mo.name_ar as option_label_ar,
             mg.id as group_id,
             mg.name as group_label,
             mg.name_ar as group_label_ar
        into v_meta
      from public.modifier_options mo
      join public.modifier_groups mg on mg.id = mo.group_id
      where mo.id = (v_option->>'optionId')::uuid;
    exception when invalid_text_representation then
      v_meta := null;
    end;

    if v_meta is not null then
      v_option := v_option || jsonb_build_object(
        'groupId', v_meta.group_id,
        'groupLabel', v_meta.group_label,
        'groupLabelAr', v_meta.group_label_ar,
        'optionLabel', coalesce(v_option->>'optionLabel', v_option->>'label', v_meta.option_label),
        'optionLabelAr', coalesce(v_option->>'optionLabelAr', v_option->>'labelAr', v_meta.option_label_ar)
      );
    end if;

    v_options := v_options || jsonb_build_array(v_option);
  end loop;

  new.selected_options := v_options;
  return new;
end;
$$;

drop trigger if exists enrich_order_item_modifier_labels on public.order_items;
create trigger enrich_order_item_modifier_labels
before insert or update of selected_options on public.order_items
for each row execute function public.enrich_order_item_modifier_labels();

-- Enrich legacy rows without changing prices, statuses, or item identity.
update public.order_items
set selected_options = selected_options
where jsonb_typeof(selected_options) = 'array';
