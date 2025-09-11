# Kitesabre (HoverKite V2)

Hoverkite V1 lives at [hoverkite/hoverkite](https://github.com/hoverkite/hoverkite). It uses a hoverboard to control a 2/3 string kite.

This repo holds the second iteration of the project. It uses ESP32 microcontrollers and ST3215 servos to control a 4 string kite.

Early iterations of hoverkite v2 (+ videos) can be found on pull requests in the hoverkite repo.

> Initial architecture based on esp32 with possibly-disconnected channels for communication
>
>             ground kitebox                       sky kitebox
>            ┌─────────────────────────┐          ┌─────────────────────────┐
>            │                         │          │                         │
>            │           esp <•••••••••••••••••••••••••••••• esp            │
>            │           now ──────────────────────────────► now            │
>            │           : ▲           │          │          │ ^            │
>            │           : │           │          │          │ :            │
>            │           v │           │          │          ▼ :            │
>            │    ┌──► main_loop() ••  │          │    ••> main_loop() ─┐   │
>            │    │                 v  │          │    :                ▼   │
>        usb │               servo_uart••>        │               servo_uart┼────►
>         ───►tty_uart                 │        ••>tty_uart                 │ servo
>            └─────────────────────────┘          └─────────────────────────┘  bus
>
>             ──► = active connection        ••> = unused connection
>
> (+ video)

-- https://github.com/hoverkite/hoverkite/pull/235

> wrap espflash --monitor in something so that we can use binary messages

-- https://github.com/hoverkite/hoverkite/pull/242

> rerun.io + ill-advised diversion into capnproto
>
> Also contains the initial redesign from box to sabre form factor.
>
> ![image](https://github.com/user-attachments/assets/1e0303c8-df12-4c95-b3e1-f137e2da028e)
>
> (+ video)

-- https://github.com/hoverkite/hoverkite/pull/245

> Switch from capnp to postcard

-- https://github.com/hoverkite/hoverkite/pull/259

## License

Licensed under either of

- Apache License, Version 2.0
  ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license
  ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the
work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any
additional terms or conditions.
