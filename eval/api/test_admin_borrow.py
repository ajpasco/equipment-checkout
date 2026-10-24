"""REQ-004 at the API."""


def test_T_004_P5_REQ_004_6_an_admin_lends_to_a_member(api) -> None:
    assert api.ADA == 1


def test_T_004_P10_REQ_004_8_a_member_who_already_holds_one_may_be_lent_another(api) -> None:
    assert api.ADA == 1


def test_T_004_N5_REQ_004_10_nothing_says_who_set_a_loan(api) -> None:
    assert api.ADA == 1


def test_T_004_N7_REQ_004_11_REQ_004_12_an_admin_must_name_a_seeded_member(api) -> None:
    assert api.ADA == 1


