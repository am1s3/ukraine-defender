// ============================================================
// 🔥 NEW: ОБНОВЛЕНИЕ ЦВЕТОВ ПО ТРИВОГАМ
// Вставь этот метод ВНУТРЬ класса ThreatMap
// ============================================================
updateAlerts(regions: Region[]) {
  console.log(`[Map] Updating ${regions.length} regions, ${regions.filter(r => r.alert).length} alerts`);

  for (const region of regions) {
    // Ищем слой по key в свойствах GeoJSON feature
    this.map.eachLayer((layer: any) => {
      if (layer.feature?.properties?.key === region.key) {
        const isAlert = region.alert;
        
        layer.setStyle({
          fillColor: isAlert ? "#ff3b3b" : "#1e3a5f",
          fillOpacity: isAlert ? 0.7 : 0.4,
          color: isAlert ? "#ff6b6b" : "#35c4ff",
          weight: isAlert ? 3 : 2
        });

        // Пульсация для активных тривог
        const el = layer.getElement?.();
        if (el) {
          const htmlEl = el as HTMLElement;
          if (isAlert) {
            htmlEl.style.animation = "regionPulse 1.5s ease-in-out infinite";
            htmlEl.style.filter = "drop-shadow(0 0 10px rgba(255,59,59,0.8))";
          } else {
            htmlEl.style.animation = "none";
            htmlEl.style.filter = "none";
          }
        }
      }
    });
  }
}
