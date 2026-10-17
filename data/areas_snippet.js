  // RESEARCHED DATA: local news and parent reports, Oct 2024 to Oct 2026 (see data/areas_researched.json).
  // Scores 1-5. crowd: 5 = very busy (inverted from the JSON's 'crowd comfort').
  var AREAS = [
    {
      "id": "old-south-baker",
      "lat": 42.9668,
      "lng": -81.2455,
      "r": 650,
      "name": {
        "en": "Old South / Wortley Village (Baker St)",
        "zh": "老南区 / Wortley 村（Baker 街）"
      },
      "s": {
        "candy": 5,
        "decor": 5,
        "safety": 4,
        "crowd": 5
      },
      "notes": {
        "en": "London's best-known Halloween street. CBC (Oct 2024) calls Baker St the 'epicenter of Halloween': 500+ kids, busy from 5:30 to 8:30 PM, one neighbour buys 1,200 candies. Old, closely spaced houses with sidewalks. Reddit parents (2024) also name Wortley for fun decorations. Halloween in the Village carnival and parade is Sat Oct 24, 2026.",
        "zh": "伦敦最有名的万圣节街区。CBC（2024 年 10 月）称 Baker 街是“万圣节中心”：500 多个孩子，5:30 到 8:30 最热闹，有邻居准备 1200 颗糖。老房子密集、人行道好走。10 月 24 日（周六）有 Wortley 村万圣节嘉年华和游行。"
      },
      "cautions": "Very crowded 5:30-8:30 PM; many families drive in, so park a few blocks away (e.g., off Wortley Rd) and walk. Watch for cars on Wortley Rd and Ridout St.",
      "streets": [
        "Baker St",
        "Wortley Rd",
        "Askin St",
        "Bruce St",
        "Cathcart St",
        "Elmwood Ave"
      ],
      "sources": [
        {
          "title": "CBC London: Baker St, 'epicenter of Halloween' (2024)",
          "url": "https://www.cbc.ca/news/canada/london/inside-the-epicenter-of-halloween-in-one-london-neighbourhood-1.7363421",
          "date": "2024-10-28"
        },
        {
          "title": "Reddit r/londonontario: Best area to trick or treat (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1g9w83o/best_area_to_trick_or_treat/",
          "date": "2024-10-22"
        },
        {
          "title": "Halloween in the Village (HitV), Sat Oct 24 2026",
          "url": "https://www.hitv.ca/",
          "date": "2026 (event page, Oct 24 2026)"
        },
        {
          "title": "Old South BA: Halloween in the Village 2026",
          "url": "https://www.oldsouthba.com/halloweeninthevillage",
          "date": "2026 (event page)"
        },
        {
          "title": "London Free Press: Wortley Village Halloween photos (2025)",
          "url": "https://lfpress.com/news/local-news/photos-londons-wortley-village-embraces-the-halloween-spirit",
          "date": "2025-10-26"
        }
      ]
    },
    {
      "id": "old-north",
      "lat": 42.999,
      "lng": -81.2475,
      "r": 750,
      "name": {
        "en": "Old North",
        "zh": "老北区"
      },
      "s": {
        "candy": 4,
        "decor": 4,
        "safety": 4,
        "crowd": 3
      },
      "notes": {
        "en": "Older homes close together with sidewalks and mature trees. Reddit (Oct 2025): 'Try Old North, still lots of houses lit up!', recommended twice in that thread.",
        "zh": "老房子密集，有人行道，环境安静。Reddit（2025 年 10 月）：“去老北区，还有很多亮灯的房子！”"
      },
      "cautions": "Only one recent thread supports it, and turnout varies by street. Cross Oxford St and Richmond St only at lights.",
      "streets": [
        "Grosvenor St",
        "Victoria St",
        "Sherwood Ave",
        "St. James St",
        "Wellington St (north of Oxford)"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Where to trick or treat (2025)",
          "url": "https://www.reddit.com/r/londonontario/comments/1oispgq/where_to_trick_or_treat/",
          "date": "2025-10-29"
        }
      ]
    },
    {
      "id": "baseline-highland",
      "lat": 42.9575,
      "lng": -81.255,
      "r": 700,
      "name": {
        "en": "Baseline Rd area (Ridout to Wharncliffe)",
        "zh": "Baseline 路一带（Ridout 至 Wharncliffe）"
      },
      "s": {
        "candy": 4,
        "decor": 4,
        "safety": 3,
        "crowd": 3
      },
      "notes": {
        "en": "Just south of Old South. Reddit residents (2025) say lots of trick-or-treaters, annual decorators and good candy, plus hidden private-drive subdivisions that hand out candy.",
        "zh": "就在老南区南边。本地居民说这里讨糖的人多、每年装饰、糖好，还有不少隐蔽的私家小区也发糖。"
      },
      "cautions": "Baseline Rd itself is a busy road: walk the side streets and cross at signals. More walking between pockets.",
      "streets": [
        "Baseline Rd W (Ridout St S to Wharncliffe Rd S)",
        "side streets and private-drive townhouse complexes off Baseline"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Where to trick or treat (2025)",
          "url": "https://www.reddit.com/r/londonontario/comments/1oispgq/where_to_trick_or_treat/",
          "date": "2025-10-29"
        }
      ]
    },
    {
      "id": "carling-heights",
      "lat": 43.002,
      "lng": -81.222,
      "r": 700,
      "name": {
        "en": "Carling Heights (Cheapside St / Bellwood Park)",
        "zh": "Carling Heights（Cheapside 街 / Bellwood 公园）"
      },
      "s": {
        "candy": 4,
        "decor": 4,
        "safety": 4,
        "crowd": 3
      },
      "notes": {
        "en": "Reddit parents (2024, 2025) report 'lots of kids and decorated houses' on Cheapside between Adelaide and Highbury, and lots of participating homes near Carling Arena and Bellwood Park.",
        "zh": "Reddit 家长说 Cheapside 街（Adelaide 到 Highbury 段）孩子多、装饰多；Carling 冰场和 Bellwood 公园附近参与的人家也很多。"
      },
      "cautions": "Cheapside St carries traffic; use crosswalks. Fewer famous displays than Old South.",
      "streets": [
        "Cheapside St (Adelaide St N to Highbury Ave N)",
        "streets around Carling Arena",
        "streets around Bellwood Park"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Best area to trick or treat (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1g9w83o/best_area_to_trick_or_treat/",
          "date": "2024-10-22"
        },
        {
          "title": "Reddit r/londonontario: Where to trick or treat (2025)",
          "url": "https://www.reddit.com/r/londonontario/comments/1oispgq/where_to_trick_or_treat/",
          "date": "2025-10-29"
        }
      ]
    },
    {
      "id": "ferndale-highview",
      "lat": 42.942,
      "lng": -81.266,
      "r": 650,
      "name": {
        "en": "Ferndale / Highview (near Wharncliffe and Southdale)",
        "zh": "Ferndale / Highview（Wharncliffe 与 Southdale 附近）"
      },
      "s": {
        "candy": 4,
        "decor": 4,
        "safety": 4,
        "crowd": 2
      },
      "notes": {
        "en": "Reddit (2025): 'Ferndale is a great street to trick or treat on! Lots of decorations and lights.' A few streets near Ferndale/Dundalk have big lawn displays good for photos; a couple of houses on Lenore were known for full-size bars.",
        "zh": "Reddit（2025）：“Ferndale 是讨糖的好街道，装饰和灯很多。”Ferndale/Dundalk 附近有大型草坪布置，适合拍照；Lenore 街曾有人家发整根巧克力。"
      },
      "cautions": "Wharncliffe Rd and Southdale Rd are busy; cross at signals. Families usually head out around 6 PM.",
      "streets": [
        "Ferndale Ave",
        "Highview Ave area (west of Wharncliffe)",
        "Lenore St",
        "streets around Ferndale and Dundalk"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: First Halloween for 5 year old (2025)",
          "url": "https://www.reddit.com/r/londonontario/comments/1og7dh3/first_halloween_for_5_year_old/",
          "date": "2025-10 (about Oct 26)"
        }
      ]
    },
    {
      "id": "pond-mills",
      "lat": 42.944,
      "lng": -81.207,
      "r": 700,
      "name": {
        "en": "Pond Mills",
        "zh": "Pond Mills"
      },
      "s": {
        "candy": 4,
        "decor": 3,
        "safety": 4,
        "crowd": 3
      },
      "notes": {
        "en": "One of the highest door counts reported on Reddit's 2024 Halloween thread (about 225 trick-or-treaters at one house), which usually means many participating homes and other families out.",
        "zh": "2024 年 Reddit 讨论中，一户人家接待了约 225 个孩子，是报告数量最高的地区之一，说明参与的人家多。"
      },
      "cautions": "Fewer big displays; some streets are townhouse complexes. Pond Mills Rd is busy.",
      "streets": [
        "residential streets off Pond Mills Rd",
        "streets north of Southdale Rd E"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Halloween discussion thread (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1ghco3w/halloween_discussion_thread/",
          "date": "2024-10/11 (Halloween 2024 night thread)"
        }
      ]
    },
    {
      "id": "white-oaks",
      "lat": 42.931,
      "lng": -81.238,
      "r": 750,
      "name": {
        "en": "White Oaks",
        "zh": "White Oaks"
      },
      "s": {
        "candy": 3,
        "decor": 3,
        "safety": 3,
        "crowd": 2
      },
      "notes": {
        "en": "Busy family area: Halloween 2024 residents reported about 120-150 trick-or-treaters at their doors.",
        "zh": "家庭多，2024 年居民报告每晚约 120-150 个孩子。"
      },
      "cautions": "Mixed with apartments; one 2024 resident only saw about 35. Stick to streets with porch lights and pumpkins.",
      "streets": [
        "Jalna Blvd area",
        "residential streets off Bradley Ave"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Halloween discussion thread (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1ghco3w/halloween_discussion_thread/",
          "date": "2024-10/11 (Halloween 2024 night thread)"
        }
      ]
    },
    {
      "id": "east-wethered",
      "lat": 42.9965,
      "lng": -81.2045,
      "r": 500,
      "name": {
        "en": "East London near Highbury and Oxford (Camp Weathered)",
        "zh": "东区 Highbury 与 Oxford 附近（Camp Weathered）"
      },
      "s": {
        "candy": 3,
        "decor": 5,
        "safety": 3,
        "crowd": 3
      },
      "notes": {
        "en": "Camp Weathered is a free, family-friendly walk-through haunted summer camp (handmade animatronics, food bank donations); up to 300 visitors in one night (CBC, Oct 2025). Its owner keeps a map of dozens of other London displays, digitized by CBC.",
        "zh": "Camp Weathered 是免费的家庭友好型“鬼怪夏令营”步行展（手工动画道具，收集食物银行捐赠），一晚最多 300 人参观（CBC，2025 年 10 月）。CBC 还整理了全市几十个大型布置的地图。"
      },
      "cautions": "Destination display more than a dense candy street; Highbury Ave and Oxford St are busy roads. Bring a non-perishable food donation.",
      "streets": [
        "Wethered St (Camp Weathered, 65 Wethered St)",
        "nearby residential streets off Highbury Ave N and Oxford St E"
      ],
      "sources": [
        {
          "title": "CBC London: map of big Halloween houses (2025)",
          "url": "https://www.cbc.ca/news/canada/london/here-s-a-halloween-map-of-the-biggest-scary-houses-to-visit-in-london-9.6944487",
          "date": "2025-10-20"
        }
      ]
    },
    {
      "id": "byron-wickerson",
      "lat": 42.957,
      "lng": -81.33,
      "r": 800,
      "name": {
        "en": "Byron / Wickerson (west end)",
        "zh": "Byron / Wickerson（西区）"
      },
      "s": {
        "candy": 3,
        "decor": 3,
        "safety": 4,
        "crowd": 2
      },
      "notes": {
        "en": "Quieter west-end family area. On the Halloween 2024 Reddit thread a Wickerson resident counted 138 trick-or-treaters, a strong number for the suburbs.",
        "zh": "西边较安静的家庭社区。2024 年万圣节 Reddit 讨论中，Wickerson 一户人家接待了 138 个孩子。"
      },
      "cautions": "Only one recent report; houses more spread out than Old South. Commissioners Rd W and Boler Rd are busy.",
      "streets": [
        "residential streets around Wickerson Rd",
        "crescents off Boler Rd"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Halloween discussion thread (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1ghco3w/halloween_discussion_thread/",
          "date": "2024-10/11 (Halloween 2024 night thread)"
        }
      ]
    },
    {
      "id": "oakridge",
      "lat": 42.988,
      "lng": -81.315,
      "r": 750,
      "name": {
        "en": "Oakridge",
        "zh": "Oakridge"
      },
      "s": {
        "candy": 4,
        "decor": 2,
        "safety": 4,
        "crowd": 2
      },
      "notes": {
        "en": "Reddit (Oct 2024): 'Oakridge. They give out full size bars!!!'",
        "zh": "Reddit（2024 年 10 月）：“Oakridge 发整根巧克力！”"
      },
      "cautions": "One person's report with a negative vote score, so treat it as a maybe. Bigger houses and lots mean more walking per door.",
      "streets": [
        "Oakridge Dr area",
        "Havenridge Cres"
      ],
      "sources": [
        {
          "title": "Reddit r/londonontario: Best area to trick or treat (2024)",
          "url": "https://www.reddit.com/r/londonontario/comments/1g9w83o/best_area_to_trick_or_treat/",
          "date": "2024-10-22"
        }
      ]
    }
  ];
