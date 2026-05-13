import type { SuperDocTemplateContent } from './super-doc-types';

export const DEFAULT_TEMPLATE: SuperDocTemplateContent = {
  hero: {
    title_template: '{{first_name}} {{last_name}} Super Doc',
    serif_word: 'Super',
  },

  warning: {
    text: "⚠️ {{first_name}}, We Know You're Busy...\nBut Don't Skip The Video Above ⚠️\n\nSeriously...\nIt's An Awesome Video\nMade For You & You Only.\nTHE VIDEO IS PROPER GOOD!!!",
  },

  how_doc_helps: {
    heading: 'How This Document Can Help You',
    body: "This doc was made just for you!\nIt breaks down our offer to you...\nWhich explains how I want to make you more money, without adding anything to your plate.\nWild I know...\nBut trust me, this is the craziest offer you'll ever get as an influencer.\nIf it's not, I'll shave my beard, head, and jump off my villa...\n(Watch the video to understand that!)\nSeriously...",
  },

  special_package: {
    heading: 'Your Special Package',
  },

  whats_inside: {
    heading: "What's Inside THIS Package For You?",
    items: [
      { number: 1, title: 'A Special Offer', description: 'This is one of the wildest offers you will ever see.' },
      { number: 2, title: 'How We Make You Money', description: 'The exact system we built for you to give you both more money & freedom.' },
      { number: 3, title: 'What Are The Next Steps?', description: 'How we can partner together and scale your business just like we have for Tyson Sonnek & many others.' },
    ],
  },

  how_we_help: {
    heading: 'How We Want To Help You',
    body: "{{first_name}}, we built this package to show you how serious we are about working together.\nWe've helped coaches scale to $70k/month by doing their sales, marketing, & fitness coaching… all done-for-you.\nNow we want to do the same for YOU.\nI'm going to show you, EXACTLY how we scale fitness business to $70k/month.",
  },

  how_it_works: {
    heading: "Here's How It Works",
    body: "We take our team & systems we've used for other influencers and help you run a coaching program that runs without you.\n\nWe handle everything — the marketing, the sales, the coaching delivery, the client management. You just keep doing what you're already doing: posting content and being you.\n\nWe've already built the infrastructure. We've already trained the team. We've already figured out what works. All we need is someone with an audience and a desire to help people.\n\nThat's where you come in.\n\nOur model is simple: we invest our time, our team, and our money upfront. We build your entire coaching business from scratch. And we only make money when you make money.",
    callout: 'WE ONLY PROFIT AFTER YOU PROFIT.',
  },

  team: {
    heading: 'Meet Our Team',
    subtitle: "The team below has scaled influencers like YOU to $70k/month",
    subtitle_sub: 'All focused on one thing — making you money.',
    founders: [
      {
        name: 'Alex Walsh',
        role: 'CMO — Chief Marketing Officer',
        description: "Alex is the marketing brain behind everything we do. He built the entire lead generation system from scratch — the funnels, the ad campaigns, the DM flows, the content strategies. He's obsessed with data, tracks every metric down to the penny, and has generated millions in revenue for fitness brands. If it makes money, Alex probably built it.",
      },
      {
        name: 'Matt Conder',
        role: 'CRO — Chief Revenue Officer',
        description: "Matt runs revenue. He built and trained our entire sales team from zero — closers, setters, onboarding specialists. He's closed over $1M in coaching deals personally and designed the sales process our team uses every day. Matt's focus is simple: collect cash, keep clients happy, and scale revenue month over month.",
      },
    ],
    operations: [
      { count: '3', role: 'Closers', description: 'Collected over $1M across all offers' },
      { count: '5', role: 'DM Setters', description: 'Booked 1000+ appointments' },
      { count: '4', role: 'Fitness Coaches', description: 'Changed hundreds of lives' },
      { count: '1', role: 'Professor of Nutrition', description: 'Teaching nutritionists for 7+ years' },
      { count: '1', role: 'Onboarding Specialist', description: 'Focused on A+ customer experience' },
      { count: '1', role: 'Director of Product', description: 'Focused on quality of coaching, testimonials, and systems' },
    ],
  },

  mission: {
    heading: 'Everything We Do For You Is To',
    bullets: [
      'Help as many people as possible',
      'Make as much money as possible',
    ],
    body: "Let me say it again…we ONLY make money when we make you money.\n\nP.S. This entire doc breaks down exactly how it works.",
  },

  tyson: {
    section_heading: "How We Helped Tyson Reach $70K+/month & How You Can Too",
    name: 'Tyson Sonnek',
    heading: 'Who Is Tyson?',
    who_cards: [
      { title: 'Veteran Sergeant of the U.S. Marine Corps', description: 'Served his country with distinction as a JTAC (Joint Terminal Attack Controller).' },
      { title: 'Gymshark Athlete', description: 'Sponsored athlete and fitness influencer with a dedicated following.' },
      { title: '1st Phorm Athlete', description: 'Brand ambassador and competitive athlete in the fitness space.' },
    ],
    situation_heading: "Tyson's Situation",
    situation_cards: [
      'Tyson was EXTREMELY busy being a Sergeant.',
      'He had ZERO time to build a coaching business.',
      'No time for marketing, no time for sales & no time to coach clients.',
    ],
    responsibilities_heading: "Tyson's Responsibilities Whilst A Sergeant",
    responsibilities_cards: [
      'Calling in Airstrikes as a JTAC',
      'Training Marines in Martial Arts',
      'Training Marines in Water Survival / Combat',
    ],
    responsibilities_callout: 'He only had time to post one reel every one or two days. EVERYTHING ELSE was done for him by US!',
    how_helped_heading: 'How Did We Help Him?',
    how_helped_steps: [
      { number: 1, title: 'We Promoted', description: 'A Free Lead Magnet using IG stories and ads' },
      { number: 2, title: 'We Booked Calls', description: 'Using Our DM Setters' },
      { number: 3, title: 'We Collected Cash', description: 'Using Our Closers' },
      { number: 4, title: 'We Coached', description: 'Using Our Fitness Coaches' },
    ],
  },

  promotion: {
    section_heading: "Here's Exactly How We Did All Of This For Him",
    heading: 'How We Promoted For Tyson',
    toc: [
      'We Built His Free Challenge',
      'We Built His Free Skool Group',
      'We Posted IG Stories to Promote',
      'Eventually, We Spent Some Money on Ads!',
    ],
    steps: [
      {
        heading: 'Step 1: We Built His Free Challenge',
        body: "The first thing we did was create a killer lead magnet — a free 6-week fitness challenge called \"The Forge.\"\n\nWe built the entire thing: the landing page, the curriculum, the workout plans, the community. Tyson just had to put his name on it and promote it in his stories.\n\nThe challenge gave people a taste of what real coaching looks like. It built trust. It built community. And most importantly, it gave our DM setters warm leads to talk to.\n\nHundreds of people signed up. And those people became our pipeline.",
      },
      {
        heading: 'Step 2: We Built His Free Skool Group',
        body: "Next, we built a free Skool community for Tyson. This was the central hub where challenge participants and followers could interact, ask questions, and get value.\n\nWe managed the community daily — posting content, answering questions, running engagement threads. Tyson would pop in when he could, but we handled the heavy lifting.\n\nThe Skool group served two purposes: it gave massive value for free (building goodwill and trust), and it gave us a pool of engaged leads who were already bought into Tyson's brand.",
      },
      {
        heading: 'Step 3: We Posted IG Stories To Promote',
        body: "(That Tyson approved of, of course!)\n\nHere's some examples of promos we've created for IG Stories. As you can see, we are psychos about tracking everything that made Tyson more money!!!\n\nWe designed story sequences that drove people to the free challenge, the Skool group, and eventually to book calls. Every story had a purpose. Every swipe-up was tracked. Every metric was measured.\n\nWe tested different hooks, different CTAs, different story formats. We found what worked and doubled down.",
      },
      {
        heading: 'Step 4: Eventually We Spent Some Money On Ads!',
        body: "Once we had the organic system dialled in, we added fuel to the fire with paid ads.\n\nWe ran Meta ads (Instagram + Facebook) driving traffic to the free challenge. The ads were simple — short-form video content featuring Tyson, with a clear CTA to join the free challenge.\n\nWe started small, tested aggressively, and scaled what worked. The results spoke for themselves.",
        callout: 'Thats a 6.89X Return on Adspend!!!',
      },
    ],
  },

  booking: {
    section_heading: 'How We Booked Sales Calls For Tyson',
    heading: 'How We Booked Sales Calls For Tyson',
    toc: [
      'We Built A Killer Sales Team',
      'We Built A Killer Culture',
      'We Engaged Leads The Second They DMed Tyson',
      'Our DM Setters Talked to Every Single Person',
      'We Figured Out What Option Is Best For Each Person',
    ],
    steps: [
      {
        heading: 'We Built A Killer Sales Team',
        body: "We didn't just hire setters — we built a machine. We recruited, trained, and managed a team of DM setters whose only job was to have genuine conversations with Tyson's followers and book qualified sales calls.\n\nEvery setter went through our proprietary training program. They learned how to build rapport, qualify leads, handle objections, and guide people toward booking a call — all without being pushy or salesy.",
      },
      {
        heading: 'We Built A Killer Culture',
        body: "Our team culture is everything. We run daily standups, weekly trainings, and monthly performance reviews. Every setter knows their numbers, knows their targets, and knows exactly what success looks like.\n\nWe celebrate wins publicly and coach through losses privately. The result? A team that genuinely cares about performance and about the people they're talking to.",
      },
      {
        heading: 'We Engaged Leads The Second They DMed Tyson',
        body: "Speed to lead is everything. When someone DMs Tyson, our setters respond within minutes — not hours, not days.\n\nWe built automated notification systems so our team knows the instant a new DM comes in. First response time is one of our most important metrics, and we track it religiously.",
      },
      {
        heading: 'Our DM Setters Talked to Every Single Person',
        body: "No lead gets left behind. Every single person who expressed interest got a personal conversation. Not a template. Not a bot. A real human being having a real conversation.\n\nOur setters are trained to listen first, understand the person's goals and challenges, and then guide them toward the right next step. For some people, that's booking a call. For others, it's joining the free challenge. Either way, everyone gets attention.",
      },
      {
        heading: 'We Figured Out What Option Is Best For Each Person',
        body: "Not everyone is ready for the same thing. Some leads are ready to invest in coaching today. Others need more nurturing. Our setters are trained to identify where each person is on their journey and match them with the right offer.\n\nThis isn't about pressure — it's about precision. The right offer to the right person at the right time.",
      },
    ],
  },

  cash: {
    section_heading: 'How We Collected Cash For Tyson',
    heading: 'How We Collected Cash For Tyson',
    toc: [
      'We Hired a Sales Team',
      'We Trained Them Into Cash Collecting Machines',
      'We Made Sure Leads Show Up To The Call',
      'Our Closers Had Deep Conversations',
      'Our Closers Took Payment $$$',
      'We Built Tracking Systems',
      'Collected More Cash From Existing Customers',
    ],
    steps: [
      {
        heading: 'We Hired a Sales Team',
        body: "We recruited experienced closers who understand fitness, understand coaching, and understand how to have a genuine conversation that leads to a sale. No hard-selling. No manipulation. Just honest conversations about whether coaching is the right fit.",
      },
      {
        heading: 'We Trained Them Into Cash Collecting Machines',
        body: "Every closer goes through our intensive training program. They learn our sales framework, practice with role-plays, shadow experienced closers, and gradually work their way up to handling calls independently.\n\nWe review every single call. We give feedback. We coach. We optimize. The result is a team that consistently closes at 25-35% — well above industry average.",
      },
      {
        heading: 'We Made Sure Leads Show Up To The Call',
        body: "Booking a call means nothing if the person doesn't show up. We built an entire show-up system: confirmation texts, reminder emails, pre-call videos, and day-of follow-ups.\n\nOur show rate consistently sits above 70%. That's because we don't just remind people — we get them excited about the call before they even pick up the phone.",
      },
      {
        heading: 'Our Closers Had Deep Conversations',
        body: "Our closers don't pitch. They have conversations. They ask about the person's goals, their current situation, their frustrations, their dreams. They listen more than they talk.\n\nBy the time the offer comes up, it feels like the natural next step — not a sales pitch. That's by design.",
      },
      {
        heading: 'Our Closers Took Payment $$$',
        body: "When someone is ready to invest, our closers handle everything. Payment plans, card processing, contract signing — all on the call. No friction. No \"I'll send you a link later.\" Everything happens in real time.\n\nThis eliminates the drop-off that kills most coaching businesses. If someone is ready, we make it easy for them to say yes.",
      },
      {
        heading: 'We Built Tracking Systems',
        body: "We track everything. Every call is recorded. Every outcome is logged. Close rates, average deal size, revenue per closer, objection frequency — we measure it all.\n\nThis data lets us identify what's working, what's not, and where to focus our training. It's the difference between guessing and knowing.",
      },
      {
        heading: 'Collected More Cash From Existing Customers',
        body: "The easiest sale is to someone who already trusts you. We built systems to identify upsell opportunities within existing clients — people who are getting results and are ready for the next level.\n\nThis added tens of thousands in additional revenue without spending a single dollar on ads.",
      },
    ],
  },

  coaching: {
    section_heading: 'How We Coached All The Clients',
    heading: 'How We Coached All The Clients',
    toc: [
      'We Hired and Trained Fitness Coaches',
      'We Onboarded Each Client With an A+ Customer Experience!',
      'We Assigned Their 1:1 Coach',
      'We Built Their Custom Diet Plan',
      'We Built Their Custom Workout Plan',
      'We Got Them Involved in Community',
      'We Measured How Good We Are At Coaching',
      'Client Wins and Transformations',
    ],
    steps: [
      {
        heading: 'We Hired and Trained Fitness Coaches',
        body: "We didn't just find coaches — we found people who are genuinely passionate about changing lives. Every coach goes through our certification program and ongoing training. They learn our systems, our standards, and our client-first philosophy.",
      },
      {
        heading: 'We Onboarded Each Client With an A+ Customer Experience!',
        body: "First impressions matter. Every new client goes through our structured onboarding process: welcome call, goal setting, expectation alignment, app setup, and introduction to their coach. By the end of onboarding, every client knows exactly what to expect and feels confident they made the right decision.",
      },
      {
        heading: 'We Assigned Their 1:1 Coach',
        body: "Every client gets matched with a dedicated coach based on their goals, experience level, and personality. This isn't group coaching hidden behind a 1:1 label — every client gets genuine, personalized attention from their assigned coach.",
      },
      {
        heading: 'We Built Their Custom Diet Plan',
        body: "Our nutrition team builds a fully customized meal plan for every single client. Not a template. Not a generic macro calculator. A real plan built around their preferences, restrictions, lifestyle, and goals. Our Professor of Nutrition oversees every plan to ensure it's scientifically sound.",
      },
      {
        heading: 'We Built Their Custom Workout Plan',
        body: "Same story for training. Every client gets a custom workout program designed for their specific goals, equipment access, experience level, and schedule. Programs are delivered through our app and updated regularly as clients progress.",
      },
      {
        heading: 'We Got Them Involved in Community',
        body: "Coaching is better with community. We built an active, supportive community where clients share wins, ask questions, and hold each other accountable. Our team moderates daily, runs challenges, and ensures everyone feels seen and supported.",
      },
      {
        heading: 'We Measured How Good We Are At Coaching',
        body: "We track client outcomes obsessively. Check-in completion rates, body composition changes, strength progress, satisfaction scores — we measure everything. If a client isn't getting results, we know about it fast and we fix it fast. Our retention rate speaks for itself.",
      },
      {
        heading: 'Client Wins and Transformations',
        body: "The proof is in the results. Our clients consistently achieve incredible transformations — losing 20-50+ lbs, building muscle, gaining confidence, and completely changing their relationship with fitness. These aren't outliers. These are the norm when you have a dedicated team running the entire operation.",
      },
    ],
  },

  results: {
    heading: "We Did A Lot For Tyson… But How Did It Change His Life?",
    body: "Tyson went from a busy Marine Sergeant with zero time to build a business… to earning $70,000+ per month from his coaching program.\n\nHe didn't have to quit his job. He didn't have to learn marketing. He didn't have to hire anyone. He didn't have to figure out sales.\n\nHe just kept posting content and being himself. We handled literally everything else.\n\nThe result? Financial freedom. A business that runs without him. A team that's obsessed with his success. And hundreds of clients whose lives have been changed.",
    callout: "And we want to do the same for you... but in less time. With us, you skip the trial and error. You get a team that's already mastered the process of scaling.",
  },

  offer: {
    heading: 'Our Special Offer To You',
    columns: [
      {
        title: 'What You Get',
        items: [
          'Your own fully managed coaching business',
          'Custom-built sales funnel and lead generation system',
          'Dedicated DM setters booking calls daily',
          'Trained closers handling all sales calls',
          'Professional fitness coaches managing every client',
          'Custom meal plans and workout programs for each client',
          'Full onboarding and client experience system',
          'Community management and engagement',
          'Complete tracking and analytics dashboard',
          'Monthly performance reviews and scaling strategy',
        ],
      },
      {
        title: 'What We Do For You',
        items: [
          'Build and manage your entire marketing system',
          'Recruit, train, and manage your sales team',
          'Handle all DM conversations and appointment booking',
          'Close sales calls and collect payment',
          'Hire, train, and manage fitness coaches',
          'Create custom nutrition and workout plans for every client',
          'Run onboarding for every new client',
          'Manage your client community daily',
          'Track every metric and optimize continuously',
          'Scale your revenue month over month',
        ],
      },
      {
        title: 'Our Partnership',
        items: [
          'We invest our team, time, and money upfront',
          'You pay nothing until you make money',
          'We only profit when you profit',
          'Full transparency on all numbers',
          'Monthly strategy calls to align on growth',
          'Complete ownership of your brand and business',
        ],
      },
    ],
    you_just: [
      'Keep posting content (reels, stories, posts)',
      'Show up for occasional brand shoots',
      'Approve marketing materials we create',
      'Collect your share of the revenue',
    ],
  },

  next_steps: {
    heading: 'Here Are The Next Steps',
    steps: [
      { number: 1, title: 'Hop On A Call', description: 'Book a quick call with our team to see if we\'re a good fit for each other. No pressure, no pitch — just a conversation about your goals and how we can help.' },
      { number: 2, title: 'Discuss Long Term', description: 'If we\'re both excited, we\'ll map out a long-term plan together. What your coaching business looks like, the revenue targets, the timeline, and exactly how we get there.' },
      { number: 3, title: 'Start Changing Lives Together', description: 'We get to work. Our team starts building your coaching business from day one. Within weeks, you\'ll have leads coming in, calls being booked, and revenue flowing.' },
    ],
  },

  cta: {
    option1_text: 'Just Respond To Our Message!',
    option2_text: 'Book A Call Below',
    calendly_url: 'https://calendar.app.google/9dBgFjjBhmoEESEf7',
  },

  faqs: {
    videos: [
      { title: 'What Is The Offer?', video_url: '' },
      { title: 'How Fast Can We Start Making Money?', video_url: '' },
      { title: 'How Does Payment Work?', video_url: '' },
      { title: 'How Does The DFY Fitness Coaching Work?', video_url: '' },
      { title: 'What Happens If A Customer Is Unhappy?', video_url: '' },
      { title: 'Do I Still Own Everything?', video_url: '' },
    ],
    text: [
      {
        question: 'What exactly do you do for me?',
        answer: 'We build and run your entire coaching business. Marketing, sales, coaching delivery, client management — everything. You just keep creating content and being you. We handle the rest.',
      },
      {
        question: 'How much does this cost me upfront?',
        answer: 'Nothing. We invest our time, team, and resources upfront. We only make money when you make money. Our model is built on partnership, not fees.',
      },
      {
        question: 'How fast will I start seeing revenue?',
        answer: 'Most partners see their first revenue within 30-60 days of launch. Within 90 days, we aim to have a consistent pipeline of leads, calls, and clients.',
      },
      {
        question: 'Do I have to stop what I\'m currently doing?',
        answer: 'Absolutely not. You keep doing exactly what you\'re doing. Posting content, working with brands, living your life. We add a revenue stream on top of everything you already have.',
      },
      {
        question: 'What if I already have a coaching program?',
        answer: 'Even better. We can either enhance what you have or build something new alongside it. Our systems and team can plug into existing operations or create from scratch.',
      },
      {
        question: 'How much of my time does this take?',
        answer: 'Minimal. You\'ll spend maybe 2-3 hours per week on approvals, occasional content, and strategy calls. That\'s it. Our team handles the other 100+ hours of work required to run the business.',
      },
      {
        question: 'Do I own the business?',
        answer: 'Yes. 100%. Your brand, your clients, your business. We\'re your operating partner, not your owner. Everything is built under your name and your brand.',
      },
      {
        question: 'What if I want to stop the partnership?',
        answer: 'You keep everything. The brand, the clients, the systems, the processes. We part ways and you continue running the business however you see fit.',
      },
      {
        question: 'How is this different from other coaching companies?',
        answer: "Most coaching companies teach you how to build a business. We build it for you. We don't sell courses or group programs about \"how to get clients.\" We actually get you clients. We bring the team, the systems, and the execution.",
      },
      {
        question: 'What kind of results can I expect?',
        answer: "It depends on your audience size and engagement, but our track record speaks for itself. We've scaled partners to $70k+/month. Your results will depend on your following, your niche, and how engaged your audience is — but we don't partner with people we don't believe we can get results for.",
      },
    ],
  },

  about: {
    heading: 'About Us',
    body: "We started Client Conversion because we saw a massive gap in the fitness industry. Influencers with huge audiences were leaving money on the table because they didn't have the time, team, or systems to monetize properly.\n\nSo we built the team. We built the systems. We figured out what works. And now we partner with influencers to do it all for them.",
    founders: [
      {
        name: 'Alex Walsh',
        role: 'Co-Founder & CMO',
        focus: [
          'Marketing strategy and execution',
          'Lead generation systems',
          'Ad campaigns and creative',
          'Data analytics and optimization',
          'Funnel architecture',
        ],
      },
      {
        name: 'Matt Conder',
        role: 'Co-Founder & CRO',
        focus: [
          'Sales team recruitment and training',
          'Revenue operations',
          'Client success and retention',
          'Partnership development',
          'Business scaling strategy',
        ],
      },
    ],
    closing: 'We are OBSESSED with making it rain. And as your partners, we focus on the actions we can take to drive revenue, fast.',
  },
};
