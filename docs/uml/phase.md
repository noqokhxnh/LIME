flowchart TD
    P1[Phase 1: Script Generation] --> Est[Tính Estimated Durations]
    Est --> P3_pre[Assemble HTML tạm thời]
    P3_pre --> P4[Preview Screenshots]
    P4 --> Confirm{User duyệt & Render?}
    Confirm -- Có --> P2[Audio Synthesis]
    P2 --> P3_real[Re-Assemble HTML với Actual Durations]
    P3_real --> P5[Render Video]
    P5 --> P6[Mux Final MP4]
