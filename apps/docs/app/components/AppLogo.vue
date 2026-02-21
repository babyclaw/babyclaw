<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
    <defs>
      <g id="huge-claw">
        <path
          d="M 0,60 Q 60,100 120,-20"
          fill="none"
          stroke="#FF5E5E"
          stroke-width="35"
          stroke-linecap="round"
        />

        <circle cx="0" cy="60" r="25" fill="#E04040" />

        <path
          d="M 0,60 C 45,90 90,45 75,0 C 60,-45 45,-60 30,-30 C 15,0 15,30 0,60 Z"
          fill="#E04040"
        />

        <path
          d="M 0,60 C -90,90 -135,-60 -75,-135 C -30,-195 15,-210 45,-150 C 75,-90 30,-15 0,60 Z"
          fill="#FF5E5E"
        />

        <path
          d="M -20,40 C -80,60 -110,-50 -60,-110 C -40,-130 -10,-140 10,-120 C -20,-100 -50,-20 -20,40 Z"
          fill="#FFC2C2"
          opacity="0.5"
        />

        <circle cx="20" cy="-60" r="6" fill="#E04040" />
        <circle cx="35" cy="-100" r="5" fill="#E04040" />
        <circle cx="5" cy="-20" r="6" fill="#E04040" />

        <circle cx="30" cy="5" r="4" fill="#FF5E5E" />
        <circle cx="45" cy="-15" r="4" fill="#FF5E5E" />
      </g>
    </defs>

    <circle cx="250" cy="250" r="230" fill="#E8F8FF" />

    <ellipse cx="250" cy="430" rx="140" ry="20" fill="#D5D8DC" opacity="0.8" />

    <path
      d="M 190,130 C 100,20 20,100 50,220"
      fill="none"
      stroke="#FF5E5E"
      stroke-width="8"
      stroke-linecap="round"
    />
    <path
      d="M 310,130 C 400,20 480,100 450,220"
      fill="none"
      stroke="#FF5E5E"
      stroke-width="8"
      stroke-linecap="round"
    />

    <path
      d="M 180,250 Q 120,230 130,270"
      fill="none"
      stroke="#E04040"
      stroke-width="14"
      stroke-linecap="round"
    />
    <path
      d="M 180,280 Q 110,280 130,310"
      fill="none"
      stroke="#E04040"
      stroke-width="14"
      stroke-linecap="round"
    />

    <path
      d="M 320,250 Q 380,230 370,270"
      fill="none"
      stroke="#E04040"
      stroke-width="14"
      stroke-linecap="round"
    />
    <path
      d="M 320,280 Q 390,280 370,310"
      fill="none"
      stroke="#E04040"
      stroke-width="14"
      stroke-linecap="round"
    />

    <g id="tail">
      <path d="M 220,390 C 180,440 160,400 210,370 Z" fill="#E04040" />
      <path d="M 280,390 C 320,440 340,400 290,370 Z" fill="#E04040" />
      <path d="M 230,400 C 230,450 270,450 270,400 Z" fill="#E04040" />

      <path d="M 190,280 L 310,280 Q 320,400 250,410 Q 180,400 190,280 Z" fill="#FF5E5E" />

      <path
        d="M 188,310 Q 250,330 312,310"
        fill="none"
        stroke="#E04040"
        stroke-width="8"
        stroke-linecap="round"
      />
      <path
        d="M 194,345 Q 250,365 306,345"
        fill="none"
        stroke="#E04040"
        stroke-width="8"
        stroke-linecap="round"
      />
      <path
        d="M 205,380 Q 250,400 295,380"
        fill="none"
        stroke="#E04040"
        stroke-width="8"
        stroke-linecap="round"
      />
    </g>

    <use href="#huge-claw" transform="translate(130, 290) rotate(-15)" />

    <use href="#huge-claw" transform="translate(370, 290) scale(-1, 1) rotate(-15)" />

    <path
      d="M 160,210 C 160,110 340,110 340,210 C 340,300 300,310 250,310 C 200,310 160,300 160,210 Z"
      fill="#FF5E5E"
    />

    <path
      d="M 180,220 C 180,150 320,150 320,220 C 320,280 290,295 250,295 C 210,295 180,280 180,220 Z"
      fill="#FF9A9A"
    />

    <ellipse
      cx="210"
      cy="150"
      rx="20"
      ry="12"
      transform="rotate(-15 210 150)"
      fill="#FFC2C2"
      opacity="0.6"
    />

    <path
      d="M 235,145 Q 220,90 190,80"
      fill="none"
      stroke="#FF5E5E"
      stroke-width="6"
      stroke-linecap="round"
    />
    <path
      d="M 265,145 Q 280,90 310,80"
      fill="none"
      stroke="#FF5E5E"
      stroke-width="6"
      stroke-linecap="round"
    />

    <g id="face">
      <ellipse cx="185" cy="235" rx="14" ry="9" fill="#E04040" opacity="0.4" />
      <ellipse cx="315" cy="235" rx="14" ry="9" fill="#E04040" opacity="0.4" />

      <circle cx="205" cy="205" r="22" fill="#2C3A47" />
      <circle cx="198" cy="198" r="8" fill="#FFFFFF" />
      <circle cx="212" cy="212" r="3" fill="#FFFFFF" />

      <circle cx="295" cy="205" r="22" fill="#2C3A47" />
      <circle cx="288" cy="198" r="8" fill="#FFFFFF" />
      <circle cx="302" cy="212" r="3" fill="#FFFFFF" />

      <path
        d="M 240,230 Q 250,245 260,230"
        fill="none"
        stroke="#2C3A47"
        stroke-width="5"
        stroke-linecap="round"
      />

      <path d="M 243,235 Q 250,252 257,235 Z" fill="#FF5E5E" />
    </g>
  </svg>
</template>
