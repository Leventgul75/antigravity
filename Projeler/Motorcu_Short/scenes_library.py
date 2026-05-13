"""
Motorcu_Short — Sahne Kutuphanesi
Her gun farkli bir yol/manzara secilir.
Motor (2006 Kawasaki KLE500, mavi) ve surucunun (kel, tuz-biber sakal) tanimi sabittir.
"""

import random
from datetime import datetime

# ── Sabit karakter + motor tanimi (her promptta tekrar edilir) ─────────────────
RIDER_AND_BIKE = (
    "MOTORCYCLE — EXACT MATCH REQUIRED: a 2006 Kawasaki KLE500 adventure-tourer in bright metallic blue. "
    "The cockpit is clearly visible in the foreground: "
    "a wide black plastic instrument binnacle housing TWO round analog gauges with amber/golden faces — "
    "LEFT: large speedometer reading 0-200 km/h with white numerals on amber background, "
    "RIGHT: smaller tachometer with identical amber face, redline at 12 x1000 r/min; "
    "bottom-left of the binnacle has THREE indicator lights: two red warning lights (top & bottom) and "
    "one blue high-beam light in the middle; top-right has two round green turn-signal indicators and N neutral indicator. "
    "The handlebar is black with round mirrors on each side. "
    "Rider glimpsed in mirrors: bald head, salt-and-pepper goatee, full-face helmet visor up. "
    "Smooth, unhurried ride — no traffic. "
)

AUDIO_AND_FORMAT = (
    "Audio: soft fingerpicked acoustic guitar + gentle wind + distant birds or matching ambient sound — calm, meditative. "
    "Warm cinematic color grade. Vertical 9:16 format, 720p, 15 seconds."
)

# ── 12 Farkli Lokasyon / Manzara ──────────────────────────────────────────────
SCENES = [
    {
        "id": "dolomites_alps",
        "title_tr": "Dolomitler'de Sabah Sisi",
        "desc_tr": "Italya Alpleri'nde kayalık zirvelerin arasında sis içinde sakin bir sabah sürüşü.",
        "road_prompt": (
            "Helmet-cam POV of a serene motorcycle ride on the iconic Passo Giau mountain road in the Italian Dolomites. "
            "Dramatic rocky peaks towering on both sides, patches of morning mist clinging to the valley below, "
            "lush green alpine meadows, wildflowers along the road edge, fresh cool morning light with long shadows. "
            "Winding hairpin turns on smooth asphalt. "
        ),
        "hashtags": "#Dolomites #Alps #Motoviaggio #KLE500 #MotorculaGün #Kawasaki #ShortsMotor"
    },
    {
        "id": "route66_desert",
        "title_tr": "Route 66 — Amerikan Çölü",
        "desc_tr": "Efsanevi Route 66 üzerinde kızıl kaya oluşumları arasında özgür bir yolculuk.",
        "road_prompt": (
            "Helmet-cam POV of a legendary ride on historic Route 66 through the Mojave Desert, USA. "
            "Vast flat desert stretching to the horizon, dramatic red sandstone buttes and mesas in the background, "
            "heat shimmer rising from the asphalt, endless straight road under a deep blue sky with a few white clouds, "
            "vintage roadside signs, tumbleweeds, late-afternoon golden light casting long shadows. "
        ),
        "hashtags": "#Route66 #USADesert #MotorYolculugu #KLE500 #Kawasaki #AdventureRide #ShortsMotor"
    },
    {
        "id": "black_sea_coast_turkey",
        "title_tr": "Karadeniz Kıyısında Yolculuk",
        "desc_tr": "Türkiye'nin Karadeniz sahilinde yeşilin her tonu ile kucaklaşan eşsiz bir rota.",
        "road_prompt": (
            "Helmet-cam POV of a breathtaking coastal ride along Turkey's Black Sea coast near Rize or Artvin. "
            "Narrow winding mountain road carved into lush emerald-green tea plantation hillsides, "
            "glimpses of the dark choppy Black Sea far below, dense forest canopy overhead, "
            "occasional waterfall cascading beside the road, misty mountain peaks in the distance, "
            "overcast moody sky with rays of sunlight breaking through. "
        ),
        "hashtags": "#Karadeniz #TurkeyMoto #KLE500 #Kawasaki #BlackSea #MotorTuru #ShortsMotor"
    },
    {
        "id": "amalfi_coast_italy",
        "title_tr": "Amalfi Kıyısında Akdeniz Büyüsü",
        "desc_tr": "İtalya'nın Amalfi Sahili'nde turkuaz deniz manzarası eşliğinde kıvrımlı yollarda sürüş.",
        "road_prompt": (
            "Helmet-cam POV of a thrilling yet peaceful ride on the Amalfi Coast road (SS163) in southern Italy. "
            "Dramatic cliffs dropping straight to the crystal-clear turquoise Tyrrhenian Sea, "
            "colorful pastel-painted villages clinging to the cliffs, lemon trees and bougainvillea along the road, "
            "narrow two-lane road with low stone walls, golden Mediterranean sunlight, yachts on the sea below. "
        ),
        "hashtags": "#AmalfiCoast #Italy #Motoviaggio #KLE500 #Kawasaki #MediterraneanRide #ShortsMotor"
    },
    {
        "id": "norwegian_fjords",
        "title_tr": "Norveç Fiyortlarında Harika Yolculuk",
        "desc_tr": "Norveç'in efsanevi Trollstigen yolunda dik yamaçlar ve şelale eşliğinde sürüş.",
        "road_prompt": (
            "Helmet-cam POV of an awe-inspiring ride on the legendary Trollstigen serpentine mountain road in Norway. "
            "Steep hairpin switchbacks ascending a dramatic mountain face, "
            "powerful waterfall (Stigfossen) roaring beside the road, deep fjord visible far below, "
            "lush moss-covered rocks, crystal-clear glacial streams crossing under bridges, "
            "overcast Nordic sky with soft diffused light, patches of snow on distant peaks. "
        ),
        "hashtags": "#Norway #Trollstigen #NordicRide #KLE500 #Kawasaki #Fjords #ShortsMotor"
    },
    {
        "id": "pacific_coast_highway",
        "title_tr": "Pasifik Sahil Yolunda Gün Batımı",
        "desc_tr": "Californiya'nın ünlü Highway 1'inde okyanus manzarası eşliğinde gün batımı sürüşü.",
        "road_prompt": (
            "Helmet-cam POV of a magical ride along California's iconic Pacific Coast Highway (Highway 1) near Big Sur. "
            "Winding coastal road hugging dramatic sea cliffs, dark blue Pacific Ocean stretching to the horizon, "
            "golden sunset light painting the sky in orange and pink, cypress trees silhouetted against the sky, "
            "sea stacks and crashing waves far below, occasional pull-out viewpoints with panoramic views. "
        ),
        "hashtags": "#PCH #BigSur #California #KLE500 #Kawasaki #CoastalRide #ShortsMotor"
    },
    {
        "id": "black_forest_germany",
        "title_tr": "Almanya Kara Ormanı'nda Gizemli Sürüş",
        "desc_tr": "Almanya'nın karanlık, mistik Kara Ormanı içindeki dar yollarda huzurlu bir keşif.",
        "road_prompt": (
            "Helmet-cam POV of a peaceful ride through the dense Black Forest (Schwarzwald) in southern Germany. "
            "Narrow winding road completely canopied by ancient dark fir and pine trees, "
            "dappled green light filtering through the dense canopy, "
            "occasional clearings revealing rolling green hills and traditional half-timbered farmhouses, "
            "morning mist rising from the forest floor, dead-quiet except for birdsong and engine rumble. "
        ),
        "hashtags": "#BlackForest #Schwarzwald #Germany #KLE500 #Kawasaki #ForestRide #ShortsMotor"
    },
    {
        "id": "cappadocia_turkey",
        "title_tr": "Kapadokya'da Peri Bacaları Arasında",
        "desc_tr": "Türkiye'nin mistik Kapadokya vadilerinde balon eşliğinde eşsiz bir motor deneyimi.",
        "road_prompt": (
            "Helmet-cam POV of a surreal motorcycle ride through Cappadocia's Rose Valley in Turkey. "
            "Otherworldly landscape of tall fairy chimneys (tuff rock formations) in rose-pink and cream tones, "
            "ancient cave churches carved into the cliffs, narrow dusty road winding between the formations, "
            "early morning light illuminating the valley in golden tones, "
            "dozens of colorful hot-air balloons floating silently in the distance above the valley, "
            "clear blue sky, absolute tranquility. "
        ),
        "hashtags": "#Kapadokya #Cappadocia #Turkey #KLE500 #Kawasaki #MotorTuru #ShortsMotor"
    },
    {
        "id": "scottish_highlands",
        "title_tr": "İskoç Dağları'nda Vahşi Doğa",
        "desc_tr": "İskoçya'nın ıssız dağlık arazisinde fırtınalı gökyüzü altında özgür bir sürüş.",
        "road_prompt": (
            "Helmet-cam POV of a wild ride on Scotland's remote A82 road through Glencoe in the Scottish Highlands. "
            "Dramatic moody highland scenery: vast open moorland covered in purple heather and rusty bracken, "
            "dark brooding mountains on all sides, a loch (lake) shimmering in the valley, "
            "dramatic overcast sky with fast-moving storm clouds, "
            "occasional ancient stone bridge over a rushing peat-stained river, no other vehicles in sight. "
        ),
        "hashtags": "#ScottishHighlands #Glencoe #Scotland #KLE500 #Kawasaki #WildRide #ShortsMotor"
    },
    {
        "id": "new_zealand_south_island",
        "title_tr": "Yeni Zelanda'nın Cennet Yolları",
        "desc_tr": "Yeni Zelanda'nın Güney Adası'nda fiordlar ve karlı tepeler arasında dünya turu.",
        "road_prompt": (
            "Helmet-cam POV of a breathtaking ride along New Zealand's Milford Road (SH94) on the South Island. "
            "Mirror-smooth glacier lake (Lake Te Anau) on one side, ancient podocarp rainforest on the other, "
            "snow-capped Southern Alps peaks towering in the background, "
            "impeccably clear mountain stream running alongside the road, "
            "soft overcast southern-hemisphere light, impossibly green vegetation, occasional waterfall. "
        ),
        "hashtags": "#NewZealand #MilfordRoad #SouthIsland #KLE500 #Kawasaki #EpicRide #ShortsMotor"
    },
    {
        "id": "ege_turkey",
        "title_tr": "Ege Sahilinde Zeytinlikler Arasında",
        "desc_tr": "Türkiye'nin Ege kıyısında zeytin ağaçları arasında lacivert deniz manzarası eşliğinde sürüş.",
        "road_prompt": (
            "Helmet-cam POV of a relaxing ride along Turkey's Aegean coast near Bodrum or Foça. "
            "Narrow road winding through ancient silver-green olive groves, "
            "glimpses of deep cobalt-blue Aegean Sea through gaps in the trees, "
            "whitewashed stone walls and terracotta-roofed villages on the hillside, "
            "wild thyme and oregano scenting the air, bright Mediterranean midday light, "
            "small fishing boats resting in a sheltered cove visible below. "
        ),
        "hashtags": "#Ege #AeganSea #Turkey #KLE500 #Kawasaki #MotorTuru #ShortsMotor"
    },
    {
        "id": "tatras_mountains_slovakia",
        "title_tr": "Tatra Dağları'nda Sonbahar",
        "desc_tr": "Slovakya'nın dramatik Tatra Dağları'nda sonbahar renkleri ile buluşma.",
        "road_prompt": (
            "Helmet-cam POV of an autumnal ride on the winding roads through Slovakia's High Tatras mountains. "
            "Brilliant autumn foliage: gold, amber, and crimson beech and birch trees lining the road, "
            "granite mountain peaks with first snow dusting them in the background, "
            "crisp clear autumn air, mirror-still mountain lake reflecting the colorful trees, "
            "empty smooth road carpeted with fallen leaves at the edges, soft warm autumn afternoon light. "
        ),
        "hashtags": "#Tatras #Slovakia #AutumnRide #KLE500 #Kawasaki #MountainRide #ShortsMotor"
    }
]


def get_todays_scene() -> dict:
    """Bugunun gunu bazli deterministik olarak bir sahne secer (ayni gun hep ayni sahne)."""
    day_of_year = datetime.now().timetuple().tm_yday
    scene = SCENES[day_of_year % len(SCENES)]
    return scene


def get_random_scene(exclude_id: str = None) -> dict:
    """Rastgele bir sahne secer, opsiyonel olarak belirli bir ID'yi haricar tutar."""
    pool = [s for s in SCENES if s["id"] != exclude_id] if exclude_id else SCENES
    return random.choice(pool)


def build_full_prompt(scene: dict) -> str:
    """Sahne + motor + ses icin tam Seedance 2 promptu olusturur."""
    return (
        f"Cinematic helmet-cam / over-the-handlebars POV motorcycle ride video. "
        f"{scene['road_prompt']}"
        f"{RIDER_AND_BIKE}"
        f"Camera occasionally pans to the surrounding landscape for a moment before returning to the road ahead. "
        f"{AUDIO_AND_FORMAT}"
    )


if __name__ == "__main__":
    scene = get_todays_scene()
    print(f"Bugünün sahnesi: {scene['title_tr']} ({scene['id']})")
    print(f"\nPrompt:\n{build_full_prompt(scene)}")
