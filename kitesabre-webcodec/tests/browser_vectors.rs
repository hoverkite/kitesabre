#![cfg(target_arch = "wasm32")]

use kitesabre_messages::Command;
use kitesabre_webcodec::{encode_command, StreamDecoder};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn encode_command_matches_expected_framing() {
    let command = Command::SetPositions {
        left: 0.3,
        right: -0.7,
    };
    let command_json = serde_wasm_bindgen::to_value(&command).expect("serialize command");
    let framed = encode_command(command_json).expect("encode");

    assert_eq!(framed.first().copied(), Some(b'#'));

    let mut payload = framed[1..].to_vec();
    let decoded = Command::from_slice(&mut payload).expect("decode payload");
    assert_eq!(decoded, command);
}

#[wasm_bindgen_test]
fn decode_stream_exposes_report_events_to_js_shape() {
    let mut decoder = StreamDecoder::new();

    let command = Command::SetPosition(123);
    let report = kitesabre_messages::Report::Command(command);
    let payload = report.to_vec().expect("encode report");

    let mut chunk = Vec::new();
    chunk.push(b'#');
    chunk.extend_from_slice(&payload);
    chunk.push(b'\n');

    let result = decoder.decode_stream(&chunk).expect("decode stream");
    let value: serde_json::Value = serde_wasm_bindgen::from_value(result).expect("convert value");

    assert_eq!(value["events"][0]["kind"], "report");
}
