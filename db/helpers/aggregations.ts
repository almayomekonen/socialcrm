export const filesJsonAgg = ` COALESCE(
    json_agg(
      DISTINCT jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'url', f.url,
        'size', f.size,
        'type', f.type,
        'agencyId', 'f.agencyId'
      )
    ) FILTER (WHERE f.id IS NOT NULL),
    '[]'
  )`

export const imgJsonAgg = `
  CASE
    WHEN main_img.id IS NULL THEN NULL
    ELSE json_build_object(
      'id', main_img.id,
      'name', main_img.name,
      'url', main_img.url,
      'type', main_img.type
    )
  END
  `
