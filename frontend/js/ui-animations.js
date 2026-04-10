(function () {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    const style = document.createElement('style');
    style.textContent = `
        :root {
            --ui-accent-start: #4f74ff;
            --ui-accent-end: #6f49cf;
            --ui-card-glow: 0 24px 42px -30px rgba(79, 116, 255, 0.56);
            --ui-border-glow: rgba(79, 116, 255, 0.16);
        }

        body {
            position: relative;
            overflow-x: hidden;
            background:
                radial-gradient(1200px 600px at -10% -20%, rgba(79, 116, 255, 0.12), transparent 58%),
                radial-gradient(900px 500px at 110% 8%, rgba(111, 73, 207, 0.12), transparent 52%),
                linear-gradient(180deg, rgba(246, 248, 255, 0.68), rgba(247, 246, 255, 0.78));
            background-attachment: fixed;
        }

        .ui-bg-mesh {
            position: fixed;
            inset: 0;
            z-index: -2;
            pointer-events: none;
            overflow: hidden;
        }

        .ui-bg-orb {
            position: absolute;
            border-radius: 9999px;
            filter: blur(38px);
            opacity: 0.35;
            animation: uiOrbDrift 16s ease-in-out infinite alternate;
        }

        .ui-bg-orb.orb-a {
            width: 380px;
            height: 380px;
            top: -140px;
            left: -120px;
            background: rgba(79, 116, 255, 0.55);
        }

        .ui-bg-orb.orb-b {
            width: 340px;
            height: 340px;
            top: 20%;
            right: -130px;
            background: rgba(111, 73, 207, 0.5);
            animation-delay: 1.7s;
        }

        .ui-bg-orb.orb-c {
            width: 300px;
            height: 300px;
            bottom: -130px;
            left: 24%;
            background: rgba(52, 211, 153, 0.32);
            animation-delay: 3.1s;
        }

        @keyframes uiOrbDrift {
            0% {
                transform: translate3d(0, 0, 0) scale(1);
            }
            100% {
                transform: translate3d(0, -28px, 0) scale(1.08);
            }
        }

        .ui-reveal {
            opacity: 0;
            transform: translateY(24px) scale(0.985);
            transition: opacity 620ms cubic-bezier(0.2, 0.65, 0.2, 1), transform 620ms cubic-bezier(0.2, 0.65, 0.2, 1);
            will-change: opacity, transform;
        }

        .ui-reveal.ui-visible {
            opacity: 1;
            transform: translateY(0) scale(1);
        }

        .ui-soft-card {
            border: 1px solid var(--ui-border-glow);
            box-shadow: var(--ui-card-glow);
            transition: transform 280ms ease, box-shadow 280ms ease, border-color 280ms ease;
            transform-style: preserve-3d;
        }

        .ui-soft-card:hover {
            border-color: rgba(79, 116, 255, 0.26);
            box-shadow: 0 28px 54px -32px rgba(79, 116, 255, 0.64);
        }

        .ui-nav-animate {
            position: relative;
            overflow: hidden;
        }

        .ui-nav-animate::after {
            content: '';
            position: absolute;
            left: -110%;
            bottom: 0;
            width: 100%;
            height: 2px;
            background: linear-gradient(90deg, var(--ui-accent-start), var(--ui-accent-end));
            opacity: 0.9;
            transition: left 320ms ease;
        }

        .ui-nav-animate:hover::after,
        .ui-nav-animate.active::after {
            left: 0;
        }

        .ui-btn-boost {
            transition: transform 260ms ease, box-shadow 260ms ease, filter 260ms ease;
        }

        .ui-btn-boost:hover {
            transform: translateY(-2px);
            box-shadow: 0 18px 34px -22px rgba(79, 116, 255, 0.8);
            filter: saturate(1.08);
        }

        .ui-magnetic {
            will-change: transform;
        }

        .ui-cursor-glow {
            position: fixed;
            width: 220px;
            height: 220px;
            border-radius: 50%;
            pointer-events: none;
            z-index: -1;
            background: radial-gradient(circle, rgba(79, 116, 255, 0.18) 0%, rgba(79, 116, 255, 0.03) 55%, transparent 70%);
            transform: translate3d(-999px, -999px, 0);
            transition: transform 140ms linear;
            filter: blur(8px);
        }

        @media (max-width: 1024px) {
            .ui-bg-orb {
                opacity: 0.24;
                filter: blur(34px);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .ui-bg-orb,
            .ui-reveal,
            .ui-soft-card,
            .ui-btn-boost,
            .ui-nav-animate::after,
            .ui-cursor-glow {
                animation: none !important;
                transition: none !important;
                transform: none !important;
            }

            .ui-reveal {
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);

    const mesh = document.createElement('div');
    mesh.className = 'ui-bg-mesh';
    mesh.innerHTML = '<span class="ui-bg-orb orb-a"></span><span class="ui-bg-orb orb-b"></span><span class="ui-bg-orb orb-c"></span>';
    document.body.prepend(mesh);

    const revealTargets = Array.from(document.querySelectorAll(
        'main > div, .bg-white, .glass, .category-card, .rounded-2xl, .rounded-3xl, .stat-card, .month-option'
    )).filter((el) => !el.classList.contains('gradient-sidebar'));

    revealTargets.forEach((element, index) => {
        element.classList.add('ui-reveal');
        if (index % 2 === 0) {
            element.classList.add('ui-soft-card');
        }
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('ui-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });

    revealTargets.forEach((element, index) => {
        element.style.transitionDelay = `${Math.min(index * 28, 320)}ms`;
        observer.observe(element);
    });

    document.querySelectorAll('.nav-link').forEach((nav) => {
        nav.classList.add('ui-nav-animate');
    });

    const actionTargets = document.querySelectorAll('button, .btn-gradient, a[class*="bg-gradient"], a[class*="bg-"]');
    actionTargets.forEach((btn) => {
        btn.classList.add('ui-btn-boost', 'ui-magnetic');
    });

    if (!prefersReducedMotion && !isTouchDevice) {
        const cursorGlow = document.createElement('div');
        cursorGlow.className = 'ui-cursor-glow';
        document.body.appendChild(cursorGlow);

        window.addEventListener('mousemove', (event) => {
            const x = event.clientX - 110;
            const y = event.clientY - 110;
            cursorGlow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        });

        document.querySelectorAll('.ui-soft-card').forEach((card) => {
            card.addEventListener('mousemove', (event) => {
                const rect = card.getBoundingClientRect();
                const px = (event.clientX - rect.left) / rect.width;
                const py = (event.clientY - rect.top) / rect.height;
                const rotateY = (px - 0.5) * 5;
                const rotateX = (0.5 - py) * 5;
                card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });

        document.querySelectorAll('.ui-magnetic').forEach((button) => {
            button.addEventListener('mousemove', (event) => {
                const rect = button.getBoundingClientRect();
                const offsetX = event.clientX - (rect.left + rect.width / 2);
                const offsetY = event.clientY - (rect.top + rect.height / 2);
                button.style.transform = `translate(${offsetX * 0.08}px, ${offsetY * 0.08}px)`;
            });

            button.addEventListener('mouseleave', () => {
                button.style.transform = '';
            });
        });
    }
})();
